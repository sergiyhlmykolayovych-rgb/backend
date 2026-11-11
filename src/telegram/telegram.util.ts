// Читає весь потік (файл зі сховища) у памʼять: Telegram приймає файли лише повним запитом.
export async function streamToBuffer(stream: AsyncIterable<unknown>) {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array),
    );
  }

  return Buffer.concat(chunks);
}
