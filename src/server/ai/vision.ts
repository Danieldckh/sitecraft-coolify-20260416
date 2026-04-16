import { generateSection, type GeneratedCode } from './sections';

export interface AnalyzeImageInput {
  imageUrl: string;
  sectionPrompt: string;
  siteContext: string;
}

export async function analyzeImage(input: AnalyzeImageInput): Promise<GeneratedCode> {
  return generateSection({
    sectionPrompt: input.sectionPrompt,
    siteContext: input.siteContext,
    referenceImageUrl: input.imageUrl,
  });
}
