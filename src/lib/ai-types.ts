import type { Profile } from "./domain";
import type { TaskKey } from "./lessons";
import type {
  EnergyPreferences,
  EnergyReference,
  KcalRange,
} from "./energy-plan";
import type { analyzeNutritionWithCompatibleAI } from "./server/nutrition-adapter";

/** Types only: no server implementation or credentials enter the browser bundle. */
export type AIComponent = TaskKey;
export interface ChatGPTModel {
  slug: string;
  displayName: string;
}
export interface ChatGPTConnectionStatus {
  available: boolean;
  signedIn: boolean;
  sharing: boolean;
  connected: boolean;
  email?: string;
  name?: string;
  model?: string;
  models?: ChatGPTModel[];
  message?: string;
}
export interface SelfHostedAIStatus {
  mode: "demo" | "self_hosted";
  configured: boolean;
  authenticated: boolean;
  connected: boolean;
  provider?: "chatgpt" | "api_key" | null;
  apiKey?: { configured: boolean; connected: boolean };
  chatgpt?: ChatGPTConnectionStatus;
  setup?: {
    available: boolean;
    configuredVia: "file" | "environment" | "none";
  };
}
export interface SelfHostedAIConfiguration {
  baseUrl: string;
  model: string;
  dailyLimit: number;
  tokenParameter: "max_tokens" | "max_completion_tokens";
  allowLocal: boolean;
  hasApiKey: boolean;
}
export interface SelfHostedAIConfigureInput {
  setupToken?: string;
  currentPassword?: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  password?: string;
  dailyLimit?: number;
  tokenParameter?: "max_tokens" | "max_completion_tokens";
  allowLocal?: boolean;
}
export interface AIPlanningInput {
  profile: Profile;
  preferences: EnergyPreferences & {
    dietaryPreferences: string;
    allergies: string;
  };
  englishSample: string;
}
export interface AIStarterPlan {
  basis: "model_guidance";
  createdAt: string;
  forDate?: string;
  /** Local freshness checksum of the generation inputs; absent on legacy plans. */
  inputKey?: string;
  nutrition: {
    status: "general_guidance" | "tracking_only";
    summary: string;
    energy?: EnergyReference;
    mealIdeas: Array<{
      meal: "breakfast" | "lunch" | "dinner";
      idea: string;
      note: string;
      budgetKcal?: KcalRange;
    }>;
  };
  english: {
    basis: "written_sample" | "unavailable";
    summary: string;
    strengths: string[];
    focusAreas: string[];
    tasks: Array<{
      component: AIComponent;
      minutes: number;
      instruction: string;
    }>;
  };
  limits: string[];
}
export interface AIOnboardingResult {
  mode: "demo" | "self_hosted";
  preferences: AIPlanningInput["preferences"];
  englishSample: string;
  plan?: AIStarterPlan;
}
export type AINutritionResult = Awaited<
  ReturnType<typeof analyzeNutritionWithCompatibleAI>
>;
