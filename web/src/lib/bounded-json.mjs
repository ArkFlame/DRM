export async function boundedJson(request, limit = 4096) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > limit) throw Error('payload_too_large');
  if (!request.body) throw Error('empty_request');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw Error('payload_too_large');
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset=0;
    for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  } finally {try{await reader.cancel()}catch{}}
}
