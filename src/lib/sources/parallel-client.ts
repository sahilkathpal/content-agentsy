import Parallel from "parallel-web";
import { requireKey } from "../../config.js";

let _client: Parallel | null = null;

export function client(): Parallel {
  if (!_client) {
    _client = new Parallel({ apiKey: requireKey("parallelApiKey") });
  }
  return _client;
}
