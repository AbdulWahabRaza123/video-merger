import React, { useState } from "react";

const App = () => {
  const [videoFile, setVideoFile] = useState(null);
  const [frames, setFrames] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    setVideoFile(file);
  };

  const processVideo = async () => {
    if (!videoFile) return;
    setLoading(true);
    setFrames([]);

    const formData = new FormData();
    formData.append("video", videoFile);

    try {
      const response = await fetch("http://localhost:5000/process-video", {
        method: "POST",
        body: formData,
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const textChunk = decoder.decode(value, { stream: true });
        try {
          const jsonChunk = JSON.parse(textChunk);
          if (jsonChunk.frames) {
            setFrames((prevFrames) => [...prevFrames, ...jsonChunk.frames]);
          }
        } catch (error) {
          console.error("Error parsing stream chunk:", error);
        }
      }
    } catch (error) {
      console.error("Error processing video:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-lg mx-auto bg-white shadow-md rounded-lg">
      <h2 className="text-2xl font-bold mb-4 text-center">Video Processor</h2>
      <input
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        className="block w-full text-sm text-gray-500 border border-gray-300 rounded-lg p-2"
      />
      <button
        onClick={processVideo}
        disabled={loading}
        className="w-full mt-4 bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 disabled:opacity-50"
      >
        {loading ? "Processing..." : "Upload & Process"}
      </button>
      {frames.length > 0 && (
        <div className="mt-4">
          <h3 className="text-lg font-semibold">Extracted Frames</h3>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {frames.map((frame, index) => (
              <img
                key={index}
                src={`data:image/png;base64,${frame}`}
                alt={`Frame ${index}`}
                className="w-full h-auto rounded-lg"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
