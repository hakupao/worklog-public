import Anthropic from "@anthropic-ai/sdk";

type Reply = object | Response;

/** A real SDK client whose fetch answers from `reply(userText)`: an object becomes the JSON text block. `onBody` sees every parsed request body. */
export function fakeAnthropic(
  reply: (userText: string) => Reply | Promise<Reply>,
  calls: string[] = [],
  onBody?: (body: any) => void,
): Anthropic {
  const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    onBody?.(body);
    const userText = body.messages[0].content as string;
    calls.push(userText);
    const r = await reply(userText);
    if (r instanceof Response) return r;
    return new Response(JSON.stringify({
      id: "msg_test", type: "message", role: "assistant", model: body.model,
      content: [{ type: "text", text: JSON.stringify(r) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return new Anthropic({ apiKey: "test", maxRetries: 0, fetch: fetch as any });
}
