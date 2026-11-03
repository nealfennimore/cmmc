// Message protocol between embedder.ts (main thread) and embed_worker.ts.
// A sibling of protocol.ts for the retrieval embedder: same load and
// read-file shapes, plus one "embed" request per batch of texts.

export type ToEmbedWorker =
    | {
          type: "load";
          repo: string;
          revision: string;
          dtype: string;
          /** Desktop path: weights are Tauri bundle resources. The worker
           *  asks for each file with "read-file", as in protocol.ts. */
          ipc?: boolean;
      }
    | {
          type: "file-data";
          fileId: number;
          data: ArrayBuffer | null;
      }
    | {
          type: "embed";
          requestId: number;
          texts: string[];
          pooling: "cls" | "mean";
      };

export type FromEmbedWorker =
    | { type: "log"; message: string }
    | { type: "read-file"; fileId: number; path: string }
    | { type: "ready" }
    | {
          /** Unit vectors, row-major: texts.length x dims, transferred. */
          type: "vectors";
          requestId: number;
          data: Float32Array;
          dims: number;
      }
    | { type: "error"; requestId?: number; message: string };
