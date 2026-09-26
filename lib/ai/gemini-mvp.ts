// NashmiOps Enterprise (MVP Edition) - Compatibility Facade
// Unified Orchestration Engine: All conversational logic consolidated in lib/ai/react-agent.ts

import {
  runReactAgent,
  processConversationalMessage,
  getMasterSystemInstruction,
  isGreetingMessage,
  cleanHumanPlainText,
  ReactAgentResult,
} from './react-agent';
import { clinicTools, executeClinicTool, phonesMatch, validateJordanianPhone } from './clinic-tools';

export {
  runReactAgent,
  processConversationalMessage,
  getMasterSystemInstruction,
  isGreetingMessage,
  cleanHumanPlainText,
  clinicTools,
  executeClinicTool,
  phonesMatch,
  validateJordanianPhone,
};

export type { ReactAgentResult };

export const systemInstruction = getMasterSystemInstruction();
export const MASTER_SYSTEM_INSTRUCTION = systemInstruction;
