export interface WhisperWorkerTranscribeRequest {
  type: "transcribe";
  id: number;
  audio: Float32Array;
  wasmBaseUrl: string;
}

export interface WhisperWorkerProgressMessage {
  type: "progress";
  id: number;
  message: string;
  percent: number | null;
}

export interface WhisperWorkerResultMessage {
  type: "result";
  id: number;
  chunks: unknown;
}

export interface WhisperWorkerErrorMessage {
  type: "error";
  id: number;
  message: string;
}

export type WhisperWorkerResponse =
  | WhisperWorkerProgressMessage
  | WhisperWorkerResultMessage
  | WhisperWorkerErrorMessage;
