export interface AiCompleteInput {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiCompleteOutput {
  text: string;
}

export interface AiProvider {
  complete(input: AiCompleteInput): Promise<AiCompleteOutput>;
}
