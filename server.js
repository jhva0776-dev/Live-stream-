const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = process.env.PORT || 3000;

let ffmpegProcess = null;
let currentStreamStatus = 'STOPPED';
let streamStartTime = null;
let lastErrorLog = 'None';

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, 'active_video' + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file uploaded.' });
  res.json({ message: 'Video uploaded successfully!', filePath: req.file.path });
});

app.post('/api/start-stream', (req, res) => {
  const { rtmpUrl, streamKey, loop } = req.body;
  if (ffmpegProcess) return res.status(400).json({ error: 'Stream is already running!' });
  if (!streamKey) return res.status(400).json({ error: 'YouTube Stream Key is required!' });

  if (!fs.existsSync(uploadDir)) {
    return res.status(400).json({ error: 'Upload folder missing.' });
  }

  const files = fs.readdirSync(uploadDir);
  if (files.length === 0) {
    return res.status(400).json({ error: 'Please upload a video first!' });
  }

  const videoPath = path.join(uploadDir, files[0]);
  const fullRtmpUrl = `${rtmpUrl || 'rtmp://a.rtmp.youtube.com/live2'}/${streamKey.trim()}`;

  const ffmpegArgs = [];
  if (loop === true || loop === 'true') {
    ffmpegArgs.push('-stream_loop', '-1');
  }
  
  ffmpegArgs.push(
    '-re',
    '-i', videoPath,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-maxrate', '2500k',
    '-bufsize', '5000k',
    '-pix_fmt', 'yuv420p',
    '-g', '50',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'flv',
    fullRtmpUrl
  );

  lastErrorLog = 'Spawning FFmpeg process...';
  ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
  currentStreamStatus = 'LIVE';
  streamStartTime = Date.now();

  ffmpegProcess.stderr.on('data', (data) => {
    lastErrorLog = data.toString();
    console.log(`FFmpeg Log: ${lastErrorLog}`);
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`FFmpeg process exited with code ${code}`);
    if (code !== 0 && code !== null) {
      lastErrorLog = `FFmpeg error exit code: ${code}`;
    } else {
      lastErrorLog = 'Stream ended normally.';
    }
    ffmpegProcess = null;
    currentStreamStatus = 'STOPPED';
    streamStartTime = null;
  });

  res.json({ message: 'Stream started successfully!' });
});

app.post('/api/stop-stream', (req, res) => {
  if (!ffmpegProcess) return res.status(400).json({ error: 'No stream is currently running.' });
  ffmpegProcess.kill('SIGINT');
  ffmpegProcess = null;
  currentStreamStatus = 'STOPPED';
  streamStartTime = null;
  lastErrorLog = 'Stream stopped manually by user.';
  res.json({ message: 'Stream stopped successfully.' });
});

app.get('/api/status', (req, res) => { 
  res.json({ 
    status: currentStreamStatus, 
    startTime: streamStartTime,
    lastError: lastErrorLog 
  }); 
});

app.listen(PORT, () => { 
  console.log(`Server is running professionally on port ${PORT}`); 
});
