import { FrameParser, type StreamFrame } from './event-stream';

const encoder = new TextEncoder();

function parseAll(chunks: (string | Uint8Array)[]): StreamFrame[] {
  const parser = new FrameParser();

  return chunks.flatMap((chunk) => parser.push(typeof chunk === 'string' ? encoder.encode(chunk) : chunk));
}

describe('FrameParser', () => {
  it('T70: dispatches a named frame and an unnamed frame at each blank line', () => {
    const frames = parseAll(['event: session\ndata: {"expiresAt":"x"}\n\ndata: {"message":"hi"}\n\n']);

    expect(frames).toEqual([
      { event: 'session', data: '{"expiresAt":"x"}' },
      { event: undefined, data: '{"message":"hi"}' },
    ]);
  });

  it('T70: holds a frame back until its blank line arrives', () => {
    const parser = new FrameParser();

    expect(parser.push(encoder.encode('data: one\n'))).toEqual([]);
    expect(parser.push(encoder.encode('\n'))).toEqual([{ event: undefined, data: 'one' }]);
  });

  it('T71: parses byte by byte exactly as it parses the whole body', () => {
    const body = encoder.encode('event: session\r\ndata: {"a":1}\r\n\r\ndata: héllo \u{1F600}\n\n');
    const whole = parseAll([body]);

    const bytewise = parseAll([...body].map((byte) => Uint8Array.of(byte)));

    expect(bytewise).toEqual(whole);
    expect(whole[1].data).toBe('héllo \u{1F600}');
  });

  it('T71: parses a multi-byte character split between two chunks', () => {
    const body = encoder.encode('data: é\u{1F600}\n\n');
    const middle = body.indexOf(0xf0) + 2;

    const frames = parseAll([body.subarray(0, middle), body.subarray(middle)]);

    expect(frames).toEqual([{ event: undefined, data: 'é\u{1F600}' }]);
  });

  it.each([
    ['CRLF', '\r\n'],
    ['lone CR', '\r'],
    ['LF', '\n'],
  ])('T72: reads %s line endings', (_name, eol) => {
    const frames = parseAll([`event: session${eol}data: one${eol}${eol}data: two${eol}${eol}`]);

    expect(frames).toEqual([
      { event: 'session', data: 'one' },
      { event: undefined, data: 'two' },
    ]);
  });

  it('T72: treats a CRLF split across two chunks as one line ending', () => {
    const frames = parseAll(['data: one\r', '\n\r', '\ndata: two\n\n']);

    expect(frames).toEqual([
      { event: undefined, data: 'one' },
      { event: undefined, data: 'two' },
    ]);
  });

  it('T73: skips comment lines, accepts data without a space and strips exactly one leading space', () => {
    const frames = parseAll([': keep-alive\ndata:tight\n\ndata:  two spaces\n\n']);

    expect(frames).toEqual([
      { event: undefined, data: 'tight' },
      { event: undefined, data: ' two spaces' },
    ]);
  });

  it('T73: joins several data lines with a newline and reads a bare field as an empty value', () => {
    const frames = parseAll(['data: a\ndata: b\ndata\n\n']);

    expect(frames).toEqual([{ event: undefined, data: 'a\nb\n' }]);
  });

  it('T73: ignores the id and retry fields', () => {
    const frames = parseAll(['id: 7\nretry: 100\ndata: x\n\n']);

    expect(frames).toEqual([{ event: undefined, data: 'x' }]);
  });

  it('T74: emits nothing for an event line without data and does not leak its name into the next frame', () => {
    const frames = parseAll(['event: session\n\ndata: later\n\n']);

    expect(frames).toEqual([{ event: undefined, data: 'later' }]);
  });

  it('T74: discards an unterminated tail', () => {
    const frames = parseAll(['data: whole\n\ndata: cut off']);

    expect(frames).toEqual([{ event: undefined, data: 'whole' }]);
  });

  it('T75: dispatches a heartbeat as a frame with empty data', () => {
    const frames = parseAll(['data: \n\ndata\n\n']);

    expect(frames).toEqual([
      { event: undefined, data: '' },
      { event: undefined, data: '' },
    ]);
  });
});
