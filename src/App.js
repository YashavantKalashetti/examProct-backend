import React, { useEffect, useRef, useState } from "react";
import Peer from "simple-peer";
import io from "socket.io-client";
import * as tf from '@tensorflow/tfjs';
import * as blazeface from '@tensorflow-models/blazeface';
import { 
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Divider,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Snackbar,
  TextField,
  Toolbar,
  Typography,
  Alert,
  Stack
} from '@mui/material';
import {
  ContentCopy as ContentCopyIcon,
  CallEnd as CallEndIcon,
  Phone as PhoneIcon,
  Warning as WarningIcon
} from '@mui/icons-material';

const socket = io.connect("https://exam-backend-demo.onrender.com", {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true
  }
});

function App() {
  // Existing states remain the same
  const [me, setMe] = useState("");
  const [stream, setStream] = useState(null);
  const [receivingCall, setReceivingCall] = useState(false);
  const [caller, setCaller] = useState("");
  const [callerSignal, setCallerSignal] = useState(null);
  const [callAccepted, setCallAccepted] = useState(false);
  const [idToCall, setIdToCall] = useState("");
  const [callEnded, setCallEnded] = useState(false);
  const [model, setModel] = useState(null);
  const [logs, setLogs] = useState([]);
  const [noFaceCount, setNoFaceCount] = useState(0);
  const [multiFaceCount, setMultiFaceCount] = useState(0);
  const [borderColor, setBorderColor] = useState('#4caf50');
  const [isTabActive, setIsTabActive] = useState(true);
  const [isLoudNoise, setIsLoudNoise] = useState(false);
  const [showSnackbar, setShowSnackbar] = useState(false);

  // Refs
  const myVideo = useRef();
  const userVideo = useRef();
  const connectionRef = useRef();
  const canvasRef = useRef();
  const logsEndRef = useRef(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  useEffect(() => {
    const loadModel = async () => {
      const loadedModel = await blazeface.load();
      setModel(loadedModel);
      console.log('BlazeFace model loaded');
    };
    loadModel();
  }, []);

  // Initialize video and socket connections
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((currentStream) => {
      setStream(currentStream);
      if (myVideo.current) myVideo.current.srcObject = currentStream;
    });

    socket.on("me", (id) => setMe(id));
    socket.on("callUser", ({ from, signal }) => {
      setReceivingCall(true);
      setCaller(from);
      setCallerSignal(signal);
    });
  }, []);

  // Monitor tab visibility
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setIsTabActive(true);
      } else {
        setIsTabActive(false);
        setLogs(prevLogs => [...prevLogs, `Tab switched at ${new Date().toLocaleTimeString()}`]);
        setBorderColor('red');
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Detect loud noises
  useEffect(() => {
    const startAudioDetection = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);
        analyser.fftSize = 512;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        let noiseDetectionTimeout = false;

        const checkVolume = () => {
          analyser.getByteFrequencyData(dataArray);
          const volume = dataArray.reduce((a, b) => a + b) / dataArray.length;

          if (volume > 24 && !noiseDetectionTimeout) {
            setLogs(prevLogs => [...prevLogs, `Loud noise detected at ${new Date().toLocaleTimeString()}`]);
            setIsLoudNoise(true);
            setBorderColor('red');

            noiseDetectionTimeout = true;
            setTimeout(() => {
              noiseDetectionTimeout = false;
            }, 1000);
          } else {
            setIsLoudNoise(false);
          }
        };

        const interval = setInterval(checkVolume, 500);
        return () => clearInterval(interval);
      } catch (error) {
        console.error('Error accessing microphone:', error);
      }
    };
    startAudioDetection();
  }, []);

  // Face detection function
  const detectFaces = async () => {
    if (!model || !myVideo.current) return;

    const video = myVideo.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

    const predictions = await model.estimateFaces(video, false);

    if (predictions.length === 0) {
      setNoFaceCount(prev => prev + 1);
      setLogs(prevLogs => [...prevLogs, `No face detected at ${new Date().toLocaleTimeString()}`]);
      setBorderColor('red');
    } else if (predictions.length > 1) {
      setMultiFaceCount(prev => prev + 1);
      setLogs(prevLogs => [...prevLogs, `Multiple faces detected at ${new Date().toLocaleTimeString()}`]);
      setBorderColor('red');
    } else {
      setBorderColor('green');
    }
  };

  // Run face detection periodically
  useEffect(() => {
    const interval = setInterval(detectFaces, 2000);
    return () => clearInterval(interval);
  }, [model, isTabActive, isLoudNoise]);

  // Video call functions
  const callUser = (id) => {
    const peer = new Peer({ initiator: true, trickle: false, stream });
    peer.on("signal", (data) => {
      socket.emit("callUser", { userToCall: id, signalData: data, from: me });
    });
    peer.on("stream", (currentStream) => {
      if (userVideo.current) userVideo.current.srcObject = currentStream;
    });
    socket.on("callAccepted", (signal) => {
      setCallAccepted(true);
      peer.signal(signal);
    });
    connectionRef.current = peer;
  };

  const answerCall = () => {
    setCallAccepted(true);
    const peer = new Peer({ initiator: false, trickle: false, stream });
    peer.on("signal", (data) => socket.emit("answerCall", { signal: data, to: caller }));
    peer.on("stream", (currentStream) => {
      if (userVideo.current) userVideo.current.srcObject = currentStream;
    });
    peer.signal(callerSignal);
    connectionRef.current = peer;
  };

  const leaveCall = () => {
    setCallEnded(true);
    connectionRef.current?.destroy();
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(me);
    setShowSnackbar(true);
  };

  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') {
      return;
    }
    setShowSnackbar(false);
  };

  return (
    <Box sx={{ flexGrow: 1, bgcolor: '#f5f5f5', minHeight: '100vh' }}>
      <AppBar position="static" sx={{ mb: 3 }}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Exam Monitoring System
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl">
        <Grid container spacing={3}>
          {/* Video Streams Section */}
          <Grid item xs={12}>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              {/* Student Video */}
              <Grid item xs={12} md={6}>
                <Paper 
                  elevation={3} 
                  sx={{ 
                    p: 2,
                    border: 3,
                    borderColor: borderColor,
                    borderRadius: 2,
                    height: '100%'
                  }}
                >
                  <Typography variant="h6" gutterBottom>
                    Student Camera
                  </Typography>
                  <Box sx={{ 
                    width: '100%', 
                    height: 400,
                    backgroundColor: '#000',
                    borderRadius: 1,
                    overflow: 'hidden'
                  }}>
                    {stream && (
                      <video
                        playsInline
                        muted
                        ref={myVideo}
                        autoPlay
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    )}
                  </Box>
                </Paper>
              </Grid>

              {/* Proctor Video */}
              <Grid item xs={12} md={6}>
                <Paper 
                  elevation={3} 
                  sx={{ 
                    p: 2,
                    border: 3,
                    borderColor: borderColor,
                    borderRadius: 2,
                    height: '100%'
                  }}
                >
                  <Typography variant="h6" gutterBottom>
                    Proctor View
                  </Typography>
                  <Box sx={{ 
                    width: '100%', 
                    height: 400,
                    backgroundColor: '#000',
                    borderRadius: 1,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {callAccepted && !callEnded ? (
                      <video
                        playsInline
                        ref={userVideo}
                        autoPlay
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <Typography variant="body1" color="white">
                        Waiting for proctor connection...
                      </Typography>
                    )}
                  </Box>
                </Paper>
              </Grid>
            </Grid>

            {/* Controls Section */}
            <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={6}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <TextField
                      fullWidth
                      variant="outlined"
                      value={me}
                      label="Your ID"
                      InputProps={{
                        readOnly: true,
                        endAdornment: (
                          <IconButton onClick={copyToClipboard}>
                            <ContentCopyIcon />
                          </IconButton>
                        ),
                      }}
                    />
                  </Stack>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <TextField
                      fullWidth
                      variant="outlined"
                      label="Enter Proctor ID"
                      value={idToCall}
                      onChange={(e) => setIdToCall(e.target.value)}
                    />
                    {callAccepted && !callEnded ? (
                      <Button
                        variant="contained"
                        color="error"
                        onClick={leaveCall}
                        startIcon={<CallEndIcon />}
                      >
                        End
                      </Button>
                    ) : (
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={() => callUser(idToCall)}
                        disabled={!idToCall}
                        startIcon={<PhoneIcon />}
                      >
                        Call
                      </Button>
                    )}
                  </Stack>
                </Grid>
              </Grid>
            </Paper>

            {/* Monitoring Section */}
            <Grid container spacing={3}>
              {/* Statistics Cards */}
              <Grid item xs={12} md={4}>
                <Paper elevation={3} sx={{ p: 2 }}>
                  <Typography variant="h6" gutterBottom>
                    Monitoring Statistics
                  </Typography>
                  <Stack spacing={2}>
                    <Card>
                      <CardContent>
                        <Typography color="text.secondary" gutterBottom>
                          Face Detection
                        </Typography>
                        <Typography variant="h5" component="div">
                          {noFaceCount + multiFaceCount}
                        </Typography>
                        <Typography variant="body2">
                          No Face: {noFaceCount} times<br />
                          Multiple Faces: {multiFaceCount} times
                        </Typography>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent>
                        <Typography color="text.secondary" gutterBottom>
                          System Status
                        </Typography>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2">
                            Tab Active: {isTabActive ? 'Yes' : 'No'}<br />
                            Audio: {isLoudNoise ? 'Noise Detected' : 'Normal'}
                          </Typography>
                        </Stack>
                      </CardContent>
                    </Card>
                  </Stack>
                </Paper>
              </Grid>

              {/* Activity Logs */}
              <Grid item xs={12} md={8}>
                <Paper 
                  elevation={3} 
                  sx={{ 
                    p: 2,
                    maxHeight: 400,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column'
                  }}
                >
                  <Typography variant="h6" gutterBottom>
                    Activity Logs
                  </Typography>
                  <List 
                    sx={{ 
                      overflow: 'auto',
                      flex: 1,
                      bgcolor: '#f5f5f5',
                      borderRadius: 1,
                      '& .warning': {
                        bgcolor: '#fff3e0'
                      }
                    }}
                  >
                    {logs.map((log, index) => (
                      <ListItem 
                        key={index}
                        className={log.includes('detected') ? 'warning' : ''}
                        divider
                      >
                        <ListItemText 
                          primary={log}
                          secondary={new Date().toLocaleTimeString()}
                        />
                      </ListItem>
                    ))}
                    <div ref={logsEndRef} />
                  </List>
                </Paper>
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </Container>

      {/* Snackbar for copy notification */}
      <Snackbar
        open={showSnackbar}
        autoHideDuration={3000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseSnackbar} severity="success" sx={{ width: '100%' }}>
          ID copied to clipboard!
        </Alert>
      </Snackbar>

      {/* Incoming Call Alert */}
      {receivingCall && !callAccepted && (
        <Snackbar
          open={true}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
          <Alert 
            severity="info"
            action={
              <Button color="inherit" size="small" onClick={answerCall}>
                Answer
              </Button>
            }
          >
            Incoming proctor call...
          </Alert>
        </Snackbar>
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </Box>
  );
}

export default App;
