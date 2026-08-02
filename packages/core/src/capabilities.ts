import { z } from "zod";

export const CAPABILITY_STATES = [
  "semantic",
  "structural",
  "repository-only",
  "unsupported",
  "experimental"
] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];
export const capabilityStateSchema = z.enum(CAPABILITY_STATES);

export const CAPABILITY_FEATURES = [
  "files",
  "modulesPackages",
  "functions",
  "classesTypes",
  "importsIncludes",
  "calls",
  "inheritance",
  "tests",
  "routes",
  "docs",
  "bodyHashes",
  "behaviorStory",
  "boundaryRules",
  "diffs",
  "renameCoalescing",
  "semanticResolution",
  "structuralResolution",
  "frameworkPlugins"
] as const;
export type CapabilityFeature = (typeof CAPABILITY_FEATURES)[number];

const featureShape = Object.fromEntries(
  CAPABILITY_FEATURES.map((feature) => [feature, capabilityStateSchema])
) as Record<CapabilityFeature, typeof capabilityStateSchema>;

export const languageCapabilitySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  extractorId: z.string().min(1),
  extractorVersion: z.string().min(1),
  features: z.object(featureShape).strict()
}).strict();
export type LanguageCapability = z.infer<typeof languageCapabilitySchema>;

export const capabilityMatrixSchema = z.object({
  $schema: z.string().min(1).optional(),
  version: z.literal(1),
  claim: z.string().min(1),
  states: z.tuple([
    z.literal("semantic"),
    z.literal("structural"),
    z.literal("repository-only"),
    z.literal("unsupported"),
    z.literal("experimental")
  ]),
  languages: z.array(languageCapabilitySchema).min(1)
}).strict().superRefine((matrix, context) => {
  const ids = new Set<string>();
  for (const [index, language] of matrix.languages.entries()) {
    if (ids.has(language.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["languages", index, "id"],
        message: `duplicate capability language id ${language.id}`
      });
    }
    ids.add(language.id);
  }
});
export type CapabilityMatrix = z.infer<typeof capabilityMatrixSchema>;
