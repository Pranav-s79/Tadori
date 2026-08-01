import capabilityMatrixJson from "../../../docs/MULTILANGUAGE_CAPABILITIES.json" with { type: "json" };
import capabilityMatrixJsonSchema from "../../../docs/multilanguage-capabilities.schema.json" with { type: "json" };
import {
  capabilityMatrixSchema,
  type CapabilityMatrix,
  type ExtractionCapability
} from "@tadori/core";
import {
  LANGUAGE_REGISTRY,
  UNKNOWN_TEXT_LANGUAGE,
  type LanguageRegistration
} from "./languageRegistry.js";

export type PrimaryCapabilityState = "semantic" | "structural" | "repository-only";

export function declaredPrimaryCapability(
  language: CapabilityMatrix["languages"][number]
): PrimaryCapabilityState {
  if (Object.values(language.features).includes("semantic")) return "semantic";
  if (Object.values(language.features).includes("structural")) return "structural";
  return "repository-only";
}

function assertRegistryParity(
  matrix: CapabilityMatrix,
  registrations: readonly LanguageRegistration[]
): void {
  const byId = new Map(registrations.map((registration) => [registration.id, registration]));
  const matrixIds = matrix.languages.map((language) => language.id).sort();
  const registryIds = [...byId.keys()].sort();
  if (JSON.stringify(matrixIds) !== JSON.stringify(registryIds)) {
    throw new Error("Capability matrix language IDs differ from the canonical registry");
  }
  for (const language of matrix.languages) {
    const registration = byId.get(language.id);
    if (registration === undefined) {
      throw new Error(`Capability language ${language.id} is absent from the registry`);
    }
    if (
      language.extractorId !== registration.extractorId ||
      language.extractorVersion !== registration.extractorVersion
    ) {
      throw new Error(`Capability extractor identity differs for ${language.id}`);
    }
    const declaredCapability = declaredPrimaryCapability(language);
    const registeredCapability: ExtractionCapability =
      declaredCapability === "repository-only"
        ? "repository"
        : declaredCapability;
    if (registeredCapability !== registration.capability) {
      throw new Error(`Capability level differs for ${language.id}`);
    }
  }
}

export const CAPABILITY_MATRIX: CapabilityMatrix = capabilityMatrixSchema.parse(capabilityMatrixJson);
assertRegistryParity(CAPABILITY_MATRIX, [...LANGUAGE_REGISTRY, UNKNOWN_TEXT_LANGUAGE]);

export const CAPABILITY_MATRIX_JSON_SCHEMA: Readonly<Record<string, unknown>> =
  capabilityMatrixJsonSchema;

export const CAPABILITY_BY_LANGUAGE = new Map(
  CAPABILITY_MATRIX.languages.map((language) => [language.id, language] as const)
);
