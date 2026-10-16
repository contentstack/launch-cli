export async function readPipedInput(stream: AsyncIterable<unknown> = process.stdin): Promise<string> {
  let text = '';

  for await (const chunk of stream) {
    text += String(chunk);
  }

  return text;
}
