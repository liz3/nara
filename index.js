var fs = require("fs"),
  PNG = require("pngjs").PNG;
const zlib = require('zlib');
var {Writable, Readable, pipeline} = require('stream');

const path = require("path")
const getFrame = path => {
  return new Promise((resolve, reject) => {
    const array = [];
    fs.createReadStream(path)
      .pipe(
        new PNG({
          //      filterType: 4,
        })
      )
      .on("parsed", function () {
        let count = 0;
        for (var y = 0; y < this.height; y++) {
          for (var x = 0; x < this.width; x++) {
            var idx = (this.width * y + x) << 2;
            const obj = {idx, r: this.data[idx], x,y, g: this.data[idx + 1], b: this.data[idx + 2], a: this.data[idx + 3]}
            array.push(obj);
          }
        }
        resolve({frame: array, width: this.width, height: this.height});

      });

  })
}
let last = {};

const convertFrameToBuffer = frame => {
  const size = ((8) * frame.length) + 4 + 5;
  const buffer = Buffer.alloc(size);
  let offset = 0;
  console.log(frame.length)
  buffer.write("FRAME");
  offset += 5;
  buffer.writeInt32LE(frame.length, offset)
  offset += 4;
  frame.forEach(entry => {
    buffer.writeUInt32LE(entry.idx || 0, offset)
    offset +=4
    buffer.writeUInt8(entry.r || 0, offset)
    offset +=1
    buffer.writeUInt8(entry.g || 0, offset)
    offset +=1
    buffer.writeUInt8(entry.b || 0, offset)
    offset +=1
    buffer.writeUInt8(entry.a || 1, offset)
    offset +=1
  });
  return buffer;
}
const waitWrite = (stream, buff) => {
  return new Promise((resolve, reject) => {

      if (!stream.write(buff)) {
        stream.once('drain', () =>  resolve());
      } else {
        resolve();
      }

  })
}

let set = false
const run = async (vpath, outPath, m= 20) => {
  const fStream = fs.createWriteStream(outPath)
  const stream = zlib.createDeflate()
  stream.pipe(fStream);
  const files = fs.readdirSync(vpath).filter(e => e.endsWith(".png"));
  for(const f of files) {
    const {frame, width, height} = await getFrame(path.join(vpath, f));
    if(!set) {
      set = true;
      last = {};
      const header = Buffer.alloc(4 + 8)
      header.write("NARA");
      header.writeUInt32LE(width, 4);
      header.writeUInt32LE(height, 8);
      await waitWrite(stream, header);
      await waitWrite(stream, convertFrameToBuffer(frame));
      frame.forEach(e => last[e.idx] = e)
      continue
    }
    const filtered = frame.filter(entry => {
      const cached = last[entry.idx];
      if(!cached) {
        console.log("noy found", entry);
        return false;
      }
      const rDiff = cached.r - entry.r;
      const gDiff = cached.g - entry.g;
      const bDiff = cached.b - entry.b;
      return rDiff > m || rDiff < -m || gDiff > m || gDiff < -m || bDiff > m || bDiff < -m;
    })
    if(filtered.length === 0) continue;
    await waitWrite(stream, convertFrameToBuffer(filtered));
    const amount = filtered.length;
    console.log("dif", amount, (amount / frame.length) * 100, frame.length - amount);
    last = {};
    frame.forEach(e => last[e.idx] = e)
  }
  stream.write(Buffer.alloc(300))
  stream.flush()
   stream.close();
   fStream.close()
}
const awaitPngWrite = (png, stream) => {
  return new Promise((resolve, reject) => {
    stream.on("finish", res => {
      resolve();
    })
    png.pack().pipe(stream)
  })
}
const read = async (filePath, outDir) => {
  let prevFrame = null;
  const rawStream = fs.createReadStream(filePath);
  const inStream = zlib.createInflate();
  rawStream.pipe(inStream)
  var bufs = [];
  inStream.on('data', function(d){
    bufs.push(d);
  });
inStream.on("error", async () => {
    let counter = 0;
    let offset = 12;
    const buf = Buffer.concat(bufs);
    if(buf.toString("utf8", 0, 4) !== "NARA") {
      console.log("not a nara file")
      return;
    }
    const width = buf.readUInt32LE(4);
    const height = buf.readUInt32LE(8);
    while(buf.toString("utf8", offset, offset + 5) === "FRAME") {
    const outf = new PNG({ width, height })
      if(prevFrame) outf.data = prevFrame
    offset += 5;
    const x = buf.readUInt32LE(offset);
    console.log(x)
    offset += 4;
    for (let i = 0; i != x; i++) {
      const idx = buf.readUInt32LE(offset)
      const r = buf.readUInt8(offset + 4)
      const g = buf.readUInt8(offset + 5)
      const b = buf.readUInt8(offset + 6)
      const a = buf.readUInt8(offset + 7)
      outf.data[idx] = r;
      outf.data[idx + 1] = g;
      outf.data[idx + 2] = b;
      outf.data[idx + 3] = a;
      offset += 8;
    }
      prevFrame = outf.data;
      await awaitPngWrite(outf, fs.createWriteStream(path.join(outDir, `extracted-${counter}.png`)))
      counter++;
   }
  })

}

let m = 20;
let inPath;
let outPath;
let action;
process.argv.forEach((arg, index) => {
  switch(arg) {
    case '-i':
    case '--infile': {
      inPath = process.argv[index + 1];
      break;
    }
    case '-o':
    case '--out': {
      outPath = process.argv[index + 1];
      break;
    }
    case '-l':
    case '--loss': {
      m = Number.parseInt(process.argv[index + 1]);
      break;
    }

    case 'encode': {
      action = "encode"
      break;
    }
  case 'decode': {
    action = "decode"
    break;
  }

  }
});

if (action === "encode") {
  run(inPath, outPath, m).then(res => {})
} else if(action === "decode") {
  read(inPath, outPath);
} else {
  console.error("unknown action")
}
