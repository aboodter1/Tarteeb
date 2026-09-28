// NashmiOps Enterprise (MVP Edition) - Network Circuit Breaker & Resilience Engine
// Automatically detects third-party outages/timeouts (Meta WhatsApp, ISTD JoFotara, Gemini AI)
// and transitions smoothly to local Simulated/Offline Mode with automatic background retry queues.

import { captureMessage } from '@/lib/monitoring/apm';

export type ServiceName = 'whatsapp' | 'jofotara' | 'gemini';
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number; // Consecutive failures before tripping to OPEN
  resetTimeoutMs: number;    // Cooldown duration before attempting HALF_OPEN
  requestTimeoutMs: number;  // Request timeout ceiling before declaring failure
}

export interface CircuitStatus {
  service: ServiceName;
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalTrippedCount: number;
  isSimulatedFallbackActive: boolean;
}

const DEFAULT_CONFIGS: Record<ServiceName, CircuitBreakerConfig> = {
  whatsapp: {
    failureThreshold: 3,
    resetTimeoutMs: 30000,   // 30 seconds cooldown
    requestTimeoutMs: 5000,  // 5 seconds timeout
  },
  jofotara: {
    failureThreshold: 3,
    resetTimeoutMs: 30000,   // 30 seconds cooldown
    requestTimeoutMs: 7000,  // 7 seconds timeout
  },
  gemini: {
    failureThreshold: 2,
    resetTimeoutMs: 20000,   // 20 seconds cooldown
    requestTimeoutMs: 5000,  // 5 seconds timeout
  },
};

interface InternalCircuitState {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalTrippedCount: number;
}

class CircuitBreakerRegistry {
  private circuits: Map<ServiceName, InternalCircuitState> = new Map();
  private configs: Map<ServiceName, CircuitBreakerConfig> = new Map();

  constructor() {
    this.initService('whatsapp', DEFAULT_CONFIGS.whatsapp);
    this.initService('jofotara', DEFAULT_CONFIGS.jofotara);
    this.initService('gemini', DEFAULT_CONFIGS.gemini);
  }

  private initService(service: ServiceName, config: CircuitBreakerConfig) {
    this.configs.set(service, config);
    this.circuits.set(service, {
      state: 'CLOSED',
      consecutiveFailures: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      totalTrippedCount: 0,
    });
  }

  /**
   * Get the current state of a service circuit with automatic HALF_OPEN transition
   */
  public getState(service: ServiceName): CircuitState {
    const circuit = this.circuits.get(service);
    const config = this.configs.get(service) || DEFAULT_CONFIGS[service];
    if (!circuit) return 'CLOSED';

    if (circuit.state === 'OPEN' && circuit.lastFailureTime) {
      const now = Date.now();
      if (now - circuit.lastFailureTime >= config.resetTimeoutMs) {
        circuit.state = 'HALF_OPEN';
        console.log(`[Circuit Breaker] Service "${service}" transitioned to HALF_OPEN trial state.`);
      }
    }

    return circuit.state;
  }

  /**
   * Determine whether a service should fall back to Simulated/Offline Mode
   */
  public isSimulatedFallbackActive(service: ServiceName): boolean {
    // Check if explicitly forced via environment variable
    if (process.env.FORCE_SIMULATED_MODE === 'true') {
      return true;
    }

    const state = this.getState(service);
    return state === 'OPEN';
  }

  /**
   * Record a successful request
   */
  public recordSuccess(service: ServiceName) {
    const circuit = this.circuits.get(service);
    if (!circuit) return;

    if (circuit.state === 'HALF_OPEN') {
      console.log(`[Circuit Breaker] Service "${service}" recovered! Circuit CLOSED.`);
    }

    circuit.state = 'CLOSED';
    circuit.consecutiveFailures = 0;
    circuit.lastSuccessTime = Date.now();
  }

  /**
   * Record a failure or timeout event
   */
  public recordFailure(service: ServiceName, error?: any): CircuitState {
    const circuit = this.circuits.get(service);
    const config = this.configs.get(service) || DEFAULT_CONFIGS[service];
    if (!circuit) return 'CLOSED';

    circuit.consecutiveFailures += 1;
    circuit.lastFailureTime = Date.now();

    const errorDetails = error?.message || String(error || 'Unknown error');

    if (circuit.state === 'HALF_OPEN' || circuit.consecutiveFailures >= config.failureThreshold) {
      if (circuit.state !== 'OPEN') {
        circuit.state = 'OPEN';
        circuit.totalTrippedCount += 1;

        console.warn(
          `[Circuit Breaker] ⚠️ Service "${service}" TRIPPED to OPEN state! ` +
          `Failures: ${circuit.consecutiveFailures}/${config.failureThreshold}. ` +
          `Switched seamlessly to local Simulated/Offline Mode. Reason: ${errorDetails}`
        );

        captureMessage(
          `Circuit Breaker TRIPPED: Service "${service}" entered OPEN state. Fallback to Simulated Mode active.`,
          'WARNING',
          {
            service,
            consecutiveFailures: circuit.consecutiveFailures,
            lastError: errorDetails,
            resetTimeoutMs: config.resetTimeoutMs,
          }
        );
      }
    }

    return circuit.state;
  }

  /**
   * Execute an operation wrapped in the circuit breaker with timeout and fallback
   */
  public async execute<T>(
    service: ServiceName,
    action: () => Promise<T>,
    fallback: (state: CircuitState, error?: any) => Promise<T> | T,
    options?: { timeoutMs?: number }
  ): Promise<T> {
    const currentState = this.getState(service);
    const config = this.configs.get(service) || DEFAULT_CONFIGS[service];
    const timeoutMs = options?.timeoutMs || config.requestTimeoutMs;

    // Fast-path: If circuit is OPEN, execute local simulated fallback immediately
    if (currentState === 'OPEN') {
      return await fallback('OPEN', new Error(`Circuit for ${service} is OPEN (Offline/Simulated Fallback)`));
    }

    try {
      // Execute with timeout promise race
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`CIRCUIT_TIMEOUT: ${service} request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
      });

      const result = await Promise.race([action(), timeoutPromise]);
      this.recordSuccess(service);
      return result;
    } catch (err: any) {
      const trippedState = this.recordFailure(service, err);
      return await fallback(trippedState, err);
    }
  }

  /**
   * Get diagnostic report of all circuits
   */
  public getStatus(service?: ServiceName): CircuitStatus | Record<ServiceName, CircuitStatus> {
    if (service) {
      const c = this.circuits.get(service)!;
      return {
        service,
        state: this.getState(service),
        consecutiveFailures: c.consecutiveFailures,
        lastFailureTime: c.lastFailureTime,
        lastSuccessTime: c.lastSuccessTime,
        totalTrippedCount: c.totalTrippedCount,
        isSimulatedFallbackActive: this.isSimulatedFallbackActive(service),
      };
    }

    const report: Partial<Record<ServiceName, CircuitStatus>> = {};
    for (const s of ['whatsapp', 'jofotara', 'gemini'] as ServiceName[]) {
      const c = this.circuits.get(s)!;
      report[s] = {
        service: s,
        state: this.getState(s),
        consecutiveFailures: c.consecutiveFailures,
        lastFailureTime: c.lastFailureTime,
        lastSuccessTime: c.lastSuccessTime,
        totalTrippedCount: c.totalTrippedCount,
        isSimulatedFallbackActive: this.isSimulatedFallbackActive(s),
      };
    }
    return report as Record<ServiceName, CircuitStatus>;
  }

  /**
   * Manually reset circuit to CLOSED
   */
  public reset(service?: ServiceName) {
    if (service) {
      const circuit = this.circuits.get(service);
      if (circuit) {
        circuit.state = 'CLOSED';
        circuit.consecutiveFailures = 0;
        circuit.lastFailureTime = null;
      }
    } else {
      for (const circuit of this.circuits.values()) {
        circuit.state = 'CLOSED';
        circuit.consecutiveFailures = 0;
        circuit.lastFailureTime = null;
      }
    }
  }

  /**
   * For testing: manually trip circuit to OPEN
   */
  public trip(service: ServiceName) {
    const circuit = this.circuits.get(service);
    if (circuit) {
      circuit.state = 'OPEN';
      circuit.lastFailureTime = Date.now();
      circuit.consecutiveFailures = 99;
      circuit.totalTrippedCount += 1;
    }
  }
}

export const circuitBreaker = new CircuitBreakerRegistry();
