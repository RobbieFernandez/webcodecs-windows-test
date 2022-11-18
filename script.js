window.addEventListener("load", (event) => {
  start();
});

function start() {
  const mp4File = MP4Box.createFile();
  let videoTrack;

  const canvas = document.getElementById("video-canvas");
  const context = canvas.getContext("2d");

  function drawFrame(frame) {
    context.drawImage(frame, 0, 0);
  }

  mp4File.onReady = info => {
    console.debug("Video Ready");
    videoTrack = info.tracks.find(t => "video" in t);
    setUpDecoder(mp4File, videoTrack, drawFrame).then(decoder => {

      mp4File.onSamples = (id, user, samples) => {
        console.debug(`Received ${samples.length} samples`);
        for (const sample of samples) {
          const videoChunk = new EncodedVideoChunk({
            type: sample.is_sync ? "key" : "delta",
            timestamp: 1e6 * sample.cts / sample.timescale,
            duration: 1e6 * sample.duration / sample.timescale,
            data: sample.data
          });
          decoder.decode(videoChunk);
        }
      }
    });

    mp4File.setExtractionOptions(videoTrack.id, null, { rapAlignment: true });

    mp4File.start();
  }


  let finishedFile = false;
  let position = 0;
  let size = 5 * 1024;

  async function feedChunk() {
    if (finishedFile) {
      return;
    }
    const buf = await fetchChunk(position, size);
    position = mp4File.appendBuffer(buf);
    finishedFile = buf.endOfFile;

    window.setTimeout(feedChunk, 200);
  }

  feedChunk();
}


async function fetchChunk(start, size) {
  const res = await fetch("stream_frames.mp4", {
    headers: {
      Range: `bytes=${start}-${start + size}`
    }
  });
  const length = parseInt(res.headers.get("Content-Length") || "0");
  const blob = await res.blob();
  const buf = await blob.arrayBuffer();
  const endOfFile = length < size;

  buf.fileStart = start;
  buf.endOfFile = endOfFile;

  return buf;
}


async function setUpDecoder(mp4File, videoTrack, onFrameReceived) {
  videoDecoder = new VideoDecoder({
    output: onFrameReceived,
    error: console.error
  });

  const config = {
    codec: videoTrack.codec,
    description: getDescription(mp4File),
    codedHeight: videoTrack.track_height,
    codedWidth: videoTrack.track_width,
  };

  const { supported } = await VideoDecoder.isConfigSupported(config);

  if (!supported) {
    throw Error("Unsupported video codec.");
  }

  videoDecoder.configure(config);
  return videoDecoder;
}


function getDescription(mp4File) {
  // Taken from the description method of this WebCodecs sample MP4Demuxer:
  //    https://github.com/w3c/webcodecs/blob/main/samples/video-decode-display/demuxer_mp4.js
  const avccBox = mp4File.moov.traks[0].mdia.minf.stbl.stsd.entries[0].avcC;
  const dataStream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
  avccBox.write(dataStream);
  return new Uint8Array(dataStream.buffer, 8);  // Remove the box header.
}
