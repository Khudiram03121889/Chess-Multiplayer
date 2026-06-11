import { useState, useEffect, useRef } from 'react';
import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, mediaDevices, RTCView as RN_RTCView } from 'react-native-webrtc';
import { db } from '../firebase/config';
import { ref, onValue, off, set, push, remove, onChildAdded } from 'firebase/database';

export const RTCView = RN_RTCView;

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
  ]
};

export function useWebRTC(gameId: string, myColor: 'w' | 'b' | null) {
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const pc = useRef<RTCPeerConnection | null>(null);
  const pendingCandidates = useRef<any[]>([]);
  const localStreamRef = useRef<any>(null);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  const rtcPath = `games/${gameId}/webrtc`;

  // Provide toggleCamera to trigger the setup
  const toggleCamera = async () => {
    if (cameraEnabled) {
      if (localStream) {
        localStream.getTracks().forEach((t: any) => t.stop());
        setLocalStream(null);
      }
      setCameraEnabled(false);
      // Wait for trigger implementation
      set(ref(db, `games/${gameId}/cameras/trigger`), Date.now());
    } else {
      try {
        const stream = await mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        setCameraEnabled(true);
        if (myColor === 'w') {
            doOffer();
        } else {
            set(ref(db, `games/${gameId}/cameras/trigger`), Date.now());
        }
      } catch (err) {
        console.warn('Camera failed', err);
      }
    }
  };

  const closePc = () => {
    if (pc.current) {
        pc.current.close();
        pc.current = null;
    }
    pendingCandidates.current = [];
    setRemoteStream(null);
  };

  const initPc = async (colorToInit: 'w' | 'b', streamToUse: any) => {
    closePc();
    const newPc = new RTCPeerConnection(ICE_SERVERS);
    pc.current = newPc;

    if (streamToUse) {
      streamToUse.getTracks().forEach((track: any) => {
        newPc.addTrack(track, streamToUse);
      });
    }

    // @ts-ignore
    newPc.ontrack = (event: any) => {
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    // @ts-ignore
    newPc.onicecandidate = (event: any) => {
      if (event.candidate) {
        push(ref(db, `${rtcPath}/ice-${colorToInit}`), event.candidate.toJSON());
      }
    };

    return newPc;
  };

  const doOffer = async () => {
    off(ref(db, `${rtcPath}/answer`));
    off(ref(db, `${rtcPath}/ice-b`));

    const newPc = await initPc('w', localStreamRef.current);
    
    await remove(ref(db, rtcPath));
    const offer = await newPc.createOffer({});
    await newPc.setLocalDescription(offer);
    await set(ref(db, `${rtcPath}/offer`), { type: offer.type, sdp: offer.sdp });

    onChildAdded(ref(db, `${rtcPath}/ice-b`), async (snap) => {
      const c = snap.val();
      if (!c) return;
      if (pc.current?.remoteDescription) {
        await pc.current.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});
      } else {
        pendingCandidates.current.push(c);
      }
    });

    onValue(ref(db, `${rtcPath}/answer`), async (snap) => {
      const d = snap.val();
      if (!d || pc.current?.remoteDescription) return;
      await pc.current?.setRemoteDescription(new RTCSessionDescription(d));
      for (const c of pendingCandidates.current) {
         await pc.current?.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});
      }
      pendingCandidates.current = [];
    });
  };

  const doAnswer = async () => {
    off(ref(db, `${rtcPath}/offer`));
    off(ref(db, `${rtcPath}/ice-w`));

    onChildAdded(ref(db, `${rtcPath}/ice-w`), async (snap) => {
      const c = snap.val();
      if (!c) return;
      if (pc.current?.remoteDescription) {
        await pc.current.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});
      } else {
        pendingCandidates.current.push(c);
      }
    });

    onValue(ref(db, `${rtcPath}/offer`), async (snap) => {
      const d = snap.val();
      if (!d) return;

      pendingCandidates.current = [];
      const newPc = await initPc('b', localStreamRef.current);
      
      await newPc.setRemoteDescription(new RTCSessionDescription(d));
      const toFlush = [...pendingCandidates.current];
      pendingCandidates.current = [];
      for (const c of toFlush) {
          await newPc.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});
      }

      const answer = await newPc.createAnswer();
      await newPc.setLocalDescription(answer);
      await set(ref(db, `${rtcPath}/answer`), { type: answer.type, sdp: answer.sdp });
    });
  };

  useEffect(() => {
    if (!gameId || !myColor) return;

    if (myColor === 'b') {
      doAnswer();
    }

    if (myColor === 'w') {
      let lastTrigger: any = null;
      const unsub = onValue(ref(db, `games/${gameId}/cameras/trigger`), (snap) => {
          const v = snap.val();
          if (lastTrigger === null) { lastTrigger = v; return; }
          if (v && v !== lastTrigger) { lastTrigger = v; doOffer(); }
      });
      return () => off(ref(db, `games/${gameId}/cameras/trigger`));
    }
  }, [gameId, myColor]);

  return { localStream, remoteStream, cameraEnabled, toggleCamera };
}
