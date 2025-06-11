import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as faceapi from 'face-api.js';
import { Play, Pause, AlertCircle, Zap } from 'lucide-react';

interface VideoStreamProps {
  streamUrl: string;
  faceDatabase: Array<{id: string, name: string, descriptor: Float32Array, image: string}>;
  blurIntensity: number;
  detectionConfidence: number;
  onProcessingChange: (processing: boolean) => void;
  autoStart?: boolean;
}

export const VideoStream: React.FC<VideoStreamProps> = ({
  streamUrl,
  faceDatabase,
  blurIntensity,
  detectionConfidence,
  onProcessingChange,
  autoStart = false
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>();
  const lastDetectionsRef = React.useRef<faceapi.WithFaceDescriptor<faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }, faceapi.FaceLandmarks68>>[]>([]);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [error, setError] = useState<string>('');
  const [detectionStats, setDetectionStats] = useState({
    fps: 0,
    facesDetected: 0,
    facesBlurred: 0
  });

  // Load face-api models
  useEffect(() => {
    const loadModels = async () => {
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri('/models/tiny_face_detector_model'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models/face_landmark_68_model'),
          faceapi.nets.faceRecognitionNet.loadFromUri('/models/face_recognition_model'),
        ]);
        setModelsLoaded(true);
      } catch (err) {
        setError('Failed to load face detection models');
      }
    };
    loadModels();
  }, []);

  // Run face detection every 200ms and cache results
  React.useEffect(() => {
    if (!modelsLoaded || !videoRef.current) return;
    let stopped = false;
    const detectLoop = async () => {
      while (!stopped) {
        if (videoRef.current && !videoRef.current.paused && !videoRef.current.ended) {
          const detections = await faceapi
            .detectAllFaces(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: detectionConfidence }))
            .withFaceLandmarks()
            .withFaceDescriptors();
          lastDetectionsRef.current = detections;
        }
        await new Promise(res => setTimeout(res, 200));
      }
    };
    detectLoop();
    return () => { stopped = true; };
  }, [modelsLoaded, detectionConfidence]);

  // Face detection and blurring logic
  const processFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !modelsLoaded) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;

    // Draw video frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Draw rectangles for cached detections
    let blurredCount = 0;
    const detections = lastDetectionsRef.current;
    for (const detection of detections) {
      const { box } = detection.detection;
      let shouldBlur = false;
      if (faceDatabase.length > 0) {
        const faceDescriptor = detection.descriptor;
        for (const knownFace of faceDatabase) {
          const distance = faceapi.euclideanDistance(faceDescriptor, knownFace.descriptor);
          if (distance < 0.6) {
            shouldBlur = true;
            break;
          }
        }
      }
      if (shouldBlur) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,0,0,0.5)';
        ctx.fillRect(box.x, box.y, box.width, box.height);
        ctx.restore();
        blurredCount++;
      }
      ctx.strokeStyle = shouldBlur ? '#ef4444' : '#22c55e';
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
    }
    setDetectionStats(ds => ({ ...ds, facesBlurred: blurredCount, facesDetected: detections.length }));
  }, [modelsLoaded, faceDatabase, detectionConfidence]);

  // Animation loop
  useEffect(() => {
    if (isPlaying && modelsLoaded) {
      const animate = () => {
        processFrame();
        animationRef.current = requestAnimationFrame(animate);
      };
      animate();
      onProcessingChange(true);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      onProcessingChange(false);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, modelsLoaded, processFrame, onProcessingChange]);

  const startStream = async () => {
    if (!streamUrl) {
      setError('Please enter a stream URL');
      return;
    }

    try {
      setError('');
      
      if (streamUrl.startsWith('http')) {
        // For HTTP/HTTPS streams, use video element directly
        if (videoRef.current) {
          videoRef.current.src = streamUrl;
          videoRef.current.crossOrigin = 'anonymous';
          await videoRef.current.play();
          setIsPlaying(true);
        }
      } else {
        // For webcam or other MediaStream sources
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 1920, height: 1080 } 
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          streamRef.current = stream;
          setIsPlaying(true);
        }
      }
    } catch (err) {
      setError('Failed to start stream: ' + (err as Error).message);
    }
  };

  const stopStream = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    setIsPlaying(false);
  };

  // Update canvas size when video loads
  const handleVideoLoadedMetadata = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      canvasRef.current.width = video.videoWidth;
      canvasRef.current.height = video.videoHeight;
      // Debug: Log when canvas size is set
      console.log('handleVideoLoadedMetadata: set canvas size to', video.videoWidth, video.videoHeight);
    }
  };

  // Auto-start logic
  React.useEffect(() => {
    if (autoStart && !isPlaying && modelsLoaded) {
      startStream();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, modelsLoaded]);

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden">
      {/* Video Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h2 className="text-lg font-semibold">Live Stream</h2>
        <div className="flex items-center space-x-4">
          {modelsLoaded ? (
            <div className="flex items-center text-green-400 text-sm">
              <Zap className="h-4 w-4 mr-1" />
              Models Ready
            </div>
          ) : (
            <div className="flex items-center text-amber-400 text-sm">
              <AlertCircle className="h-4 w-4 mr-1" />
              Loading Models...
            </div>
          )}
          
          <div className="flex items-center space-x-2">
            <button
              onClick={isPlaying ? stopStream : startStream}
              disabled={!modelsLoaded}
              className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              <span>{isPlaying ? 'Stop' : 'Start'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Video Container */}
      <div className="relative aspect-video bg-gray-900">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-contain"
          style={{ opacity: 0, zIndex: 1 }}
          onLoadedMetadata={handleVideoLoadedMetadata}
          muted
          playsInline
        />
        
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-contain"
          style={{ zIndex: 10, pointerEvents: 'none', opacity: 1 }}
        />

        {/* Overlay Stats */}
        {isPlaying && (
          <div className="absolute top-4 left-4 bg-black bg-opacity-70 rounded-lg p-3 text-sm">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-gray-400">FPS</div>
                <div className="font-mono text-lg">{detectionStats.fps}</div>
              </div>
              <div>
                <div className="text-gray-400">Detected</div>
                <div className="font-mono text-lg text-green-400">{detectionStats.facesDetected}</div>
              </div>
              <div>
                <div className="text-gray-400">Blurred</div>
                <div className="font-mono text-lg text-red-400">{detectionStats.facesBlurred}</div>
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-red-600 text-white px-6 py-4 rounded-lg flex items-center space-x-2">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Placeholder */}
        {!isPlaying && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <Play className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Enter stream URL and click Start to begin</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};