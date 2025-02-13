import React, { useState, useEffect, useRef } from "react";
import runpodSdk from "runpod-sdk";
import * as inputData from "./input.json";
import * as inputData2 from "./image.json";
// RunPod API Setup
const API_KEY = "AB8VTORYC3FJ40SFG9DASLOCCP87GPWJPJ686CMZ";
const ENDPOINT_ID = "za2iqcbvgiufvk";
const runpod = runpodSdk(API_KEY);
const endpoint = runpod.endpoint(ENDPOINT_ID);
import { createFFmpeg } from "@ffmpeg/ffmpeg";

const VideoFromMP4Frames = ({ frames }) => {
  const [videoUrl, setVideoUrl] = useState(null);
  const ffmpeg = createFFmpeg({
    log: true,
    corePath: "/ffmpeg-core.js", // Self-hosted FFmpeg core
    wasmPath: "/ffmpeg-core.wasm", // Explicit WebAssembly path
    workerPath: "/ffmpeg-core.worker.js", // Explicit worker path
  });

  useEffect(() => {
    const generateVideo = async () => {
      if (!frames || frames.length === 0) return;

      await ffmpeg.load();

      try {
        // Write each base64 frame as an MP4 file
        for (let i = 0; i < frames.length; i++) {
          const byteCharacters = atob(frames[i]);
          const byteArray = new Uint8Array(byteCharacters.length);
          for (let j = 0; j < byteCharacters.length; j++) {
            byteArray[j] = byteCharacters.charCodeAt(j);
          }
          ffmpeg.FS("writeFile", `frame${i}.mp4`, byteArray);
        }

        // Convert MP4 frames to TS format for concatenation
        for (let i = 0; i < frames.length; i++) {
          console.log(`Processing frame${i}.mp4...`);
          await ffmpeg.run(
            "-y",
            "-i",
            `frame${i}.mp4`,
            "-c:v",
            "libx264",
            "-crf",
            "23",
            "-preset",
            "ultrafast",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-bsf:v",
            "h264_mp4toannexb",
            "-f",
            "mpegts",
            `segment${i}.ts`
          );

          // Ensure segment file is created
          if (!ffmpeg.FS("readdir", "/").includes(`segment${i}.ts`)) {
            console.error(`Error: segment${i}.ts was not created. Retrying...`);
            await new Promise((resolve) => setTimeout(resolve, 500)); // Short delay before retry
            await ffmpeg.run(
              "-y",
              "-i",
              `frame${i}.mp4`,
              "-c:v",
              "libx264",
              "-crf",
              "23",
              "-preset",
              "ultrafast",
              "-c:a",
              "aac",
              "-b:a",
              "128k",
              "-bsf:v",
              "h264_mp4toannexb",
              "-f",
              "mpegts",
              `segment${i}.ts`
            );
          }
        }

        // Create file list for concatenation
        const fileList = frames
          .map((_, i) => `file 'segment${i}.ts'`)
          .join("\n");
        ffmpeg.FS(
          "writeFile",
          "input.txt",
          new TextEncoder().encode(fileList.replace(/\r/g, ""))
        ); // Ensure UNIX-style newlines

        // Merge TS files into a single MP4
        await ffmpeg.run(
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          "input.txt",
          "-c",
          "copy",
          "-bsf:a",
          "aac_adtstoasc",
          "output.mp4"
        );

        console.log("FFmpeg Files:", ffmpeg.FS("readdir", "/"));

        if (ffmpeg.FS("readdir", "/").includes("output.mp4")) {
          const data = ffmpeg.FS("readFile", "output.mp4");
          const videoBlob = new Blob([data.buffer], { type: "video/mp4" });
          setVideoUrl(URL.createObjectURL(videoBlob));
        } else {
          console.error("FFmpeg failed to generate output.mp4");
        }
      } catch (err) {
        console.error("FFmpeg error:", err);
      }
    };

    generateVideo();
  }, [frames]);

  return (
    <div className="mt-4">
      <h3 className="text-lg font-semibold">Merged Video</h3>
      {!videoUrl ? (
        <p className="text-red-500">Processing...</p>
      ) : (
        <video controls width="100%" className="rounded-lg shadow-md">
          <source src={videoUrl} type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      )}
    </div>
  );
};

const VideoProcessor = () => {
  const [imageFile, setImageFile] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [frames, setFrames] = useState([]);
  const [videoBase64, setVideoBase64] = useState(null);
  const [loading, setLoading] = useState(false);
  const frameQueue = useRef([]);
  const [processing, setProcessing] = useState(false);
  function imageToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = reader.result.split(",")[1]; // Remove the prefix
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  }

  function audioToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = reader.result.split(",")[1]; // Remove the prefix
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  }
  // const mergeBase64Chunks = (chunks) => {
  //   const sanitizedChunks = chunks.map((chunk) => chunk.trim());
  //   const fullBase64 = sanitizedChunks.join("");
  //   return fullBase64;
  // };

  const processInputs = async () => {
    if (!imageFile && !audioFile)
      return alert("Please upload a image and audio file first!");

    setLoading(true);
    setFrames([]);
    setVideoBase64(null);
    frameQueue.current = [];
    setProcessing(true);

    try {
      const processedImage = await imageToBase64(imageFile);
      const processedAudio = await audioToBase64(audioFile);

      const requestData = {
        // default: {
        //   input: { face: processedImage, audio: processedAudio },
        // },
        input: { face: processedImage, audio: processedAudio },
      };

      console.log("Sending Request:", requestData);

      const { id } = await endpoint.runSync(
        JSON.stringify(requestData),
        60000000
      );
      if (!id) throw new Error("Failed to get job ID from RunPod");

      console.log("Job ID received:", id);

      let videoChunks = "";
      for await (const result of endpoint.stream(id, 60000000)) {
        if (result && result.output) {
          try {
            const framesData = JSON.parse(result.output);
            // console.log("This is frames data ", framesData);
            // console.log("This is result ", result);
            videoChunks += framesData.video;
            // console.log("This is framesData ", framesData);
            setVideoBase64(framesData.video);
            setFrames((prev) => [...prev, framesData.video]);
            // if (framesData) {
            //   // console.log("Received frames:", framesData.frames.length);
            //   setFrames((prevFrames) => [...prevFrames, ...framesData.video]);
            // }
          } catch (err) {
            console.error("Error processing output:", err);
          }
        }
      }
    } catch (error) {
      console.error("Error processing inputs:", error);
    } finally {
      setLoading(false);
      setProcessing(false);
    }
  };
  // console.log("Final Video Base64:", videoBase64?.substring(0, 100)); // Check first 100 characters

  return (
    <div className="p-6 max-w-lg mx-auto bg-white shadow-md rounded-lg">
      <h2 className="text-2xl font-bold mb-4 text-center">RunPod Processor</h2>

      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          console.log("This is e ", e);
          const file = e.target.files[0];
          setImageFile(file);
        }}
        className="block w-full text-sm text-gray-500 border border-gray-300 rounded-lg p-2 mb-2"
      />
      <input
        type="file"
        accept="audio/*"
        onChange={(e) => {
          console.log("This is e ", e);
          const file = e.target.files[0];
          setAudioFile(file);
        }}
        className="block w-full text-sm text-gray-500 border border-gray-300 rounded-lg p-2 mb-2"
      />

      <button
        onClick={processInputs}
        disabled={loading}
        className="w-full mt-4 bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 disabled:opacity-50"
      >
        {loading ? "Processing..." : "Upload & Process"}
      </button>

      {/* {frames.length > 0 && (
        <div className="mt-4">
          <h3 className="text-lg font-semibold">Processed Video</h3>
          <video controls width="100%" className="rounded-lg shadow-md">
            <source
              src={`data:video/mp4;base64,${frames?.join("")}`}
              type="video/mp4"
            />
            Your browser does not support the video tag.
          </video>
        </div>
      )} */}
      {frames.length > 0 && <VideoFromMP4Frames frames={frames} />}

      {frames.length > 0 && (
        <div className="mt-4">
          <h3 className="text-lg font-semibold">Extracted Frames</h3>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {frames.map((frame, index) => {
              return (
                <>
                  <video
                    key={index}
                    controls
                    width="100%"
                    className="rounded-lg shadow-md"
                  >
                    <source
                      src={`data:video/mp4;base64,${frame}`}
                      type="video/mp4"
                    />
                    Your browser does not support the video tag.
                  </video>
                </>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoProcessor;
