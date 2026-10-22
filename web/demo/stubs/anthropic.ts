// Demo stand-in for @anthropic-ai/sdk: the demo env has no ANTHROPIC_API_KEY, so the server never constructs a client
// (sweep, digests and the PDF composer check the key first and answer "unavailable"). Constructing one anyway fails
// loudly instead of reaching the network.
export default class Anthropic {
  constructor() { throw new Error("No model calls in the demo (no ANTHROPIC_API_KEY)"); }
}
