import { useState, useEffect, useRef, useCallback } from 'react';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
  RTCView as RN_RTCView,
} from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
import { db } from '../firebase/config';
import { ref, onValue, set, push, remove, onChildAdded } from 'firebase/database';

export const RTCView = RN_RTCView;

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
  ]
};

const trackCount = (tracks: any[] | undefined) => tracks?.filter(Boolean).length || 0;

const getTracks = (stream: any) => {
  try {
    return stream?.getTracks?.() || [];
  } catch {
    return [];
  }
};

const getLocalTrackCount = (peerConnection: any, stream?: any) => {
  try {
    const senderTracks = peerConnection?.getSenders?.().map((sender: any) => sender.track) || [];
    return trackCount(senderTracks);
  } catch {
    return trackCount(getTracks(stream));
  }
};

const getRemoteTrackCount = (peerConnection: any, stream?: any) => {
  try {
    const receiverTracks = peerConnection?.getReceivers?.().map((receiver: any) => receiver.track) || [];
    return trackCount(receiverTracks);
  } catch {
    return trackCount(getTracks(stream));
  }
};

const getCandidateType = (candidate: any) => {
  const candidateString = typeof candidate === 'string' ? candidate : candidate?.candidate;
  const match = candidateString?.match?.(/\btyp\s+([a-zA-Z0-9-]+)/);
  return match?.[1] || null;
};

const webrtcData = (peerConnection: any, extra: Record<string, any> = {}) => ({
  localTracks: getLocalTrackCount(peerConnection, localStreamRefSafe(peerConnection)),
  remoteTracks: getRemoteTrackCount(peerConnection, remoteStreamRefSafe(peerConnection)),
  candidateType: extra.candidateType ?? getCandidateType(extra.candidate),
  sdpType: extra.sdpType ?? extra.description?.type ?? extra.sdp?.type ?? null,
  connectionState: peerConnection?.connectionState ?? null,
  iceConnectionState: peerConnection?.iceConnectionState ?? null,
  peerConnectionState: peerConnection?.connectionState ?? null,
  signalingState: peerConnection?.signalingState ?? null,
  ...extra,
});

const webrtcLog = (eventName: string, peerConnection: any, data: Record<string, any> = {}) => {
  console.log("[WEBRTC]", eventName, webrtcData(peerConnection, data));
};

const localStreamRefSafe = (peerConnection: any) => peerConnection?._diagnosticLocalStream || null;
const remoteStreamRefSafe = (peerConnection: any) => peerConnection?._diagnosticRemoteStream || null;

const getTrackDetails = (stream: any) => getTracks(stream).map((track: any) => ({
  id: track?.id || null,
  kind: track?.kind || null,
  enabled: track?.enabled ?? null,
  muted: track?.muted ?? null,
  readyState: track?.readyState || null,
}));

const CAMERA_TRACK_WAIT_MS = 8000;
const CAMERA_TRACK_POLL_MS = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getVideoTracks = (stream: any) => {
  try {
    return stream?.getVideoTracks?.() || getTracks(stream).filter((track: any) => track?.kind === 'video');
  } catch {
    return [];
  }
};

const getLiveVideoTracks = (stream: any) => getVideoTracks(stream).filter((track: any) => track?.readyState !== 'ended');

const hasLiveVideoTrack = (stream: any) => getLiveVideoTracks(stream).length > 0;

const getLocalVideoSenderCount = (peerConnection: any) => {
  try {
    return peerConnection?.getSenders?.().filter((sender: any) => {
      const track = sender?.track;
      return track?.kind === 'video' && track?.readyState !== 'ended';
    }).length || 0;
  } catch {
    return 0;
  }
};

export function useWebRTC(gameId: string | null, myColor: 'w' | 'b' | null) {
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const pc = useRef<RTCPeerConnection | null>(null);
  const pendingCandidates = useRef<any[]>([]);
  const localStreamRef = useRef<any>(null);
  const remoteStreamRef = useRef<any>(null);
  const listenersRef = useRef<Array<() => void>>([]);
  const negotiationListenersRef = useRef<Array<() => void>>([]);
  const offerInProgress = useRef(false);
  const cameraInitPromise = useRef<Promise<any> | null>(null);
  const sessionId = useRef(0);
  const offerSessionId = useRef<string | null>(null);
  const currentPcId = useRef<number>(0);
  const isAnswerInitializing = useRef(false);
  const mountedRef = useRef(true);
  const audioMutedRef = useRef(false);
  const inCallAudioRouteActiveRef = useRef(false);
  const speakerRouteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionStateSequence = useRef<string[]>([]);
  const iceConnectionStateSequence = useRef<string[]>([]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  const rtcPath = gameId ? `games/${gameId}/webrtc` : null;

  const clearSpeakerRouteTimer = useCallback(() => {
    if (speakerRouteTimerRef.current) {
      clearTimeout(speakerRouteTimerRef.current);
      speakerRouteTimerRef.current = null;
    }
  }, []);

  const forceLoudSpeakerRoute = useCallback((reason: string) => {
    try {
      InCallManager.setForceSpeakerphoneOn(true);
      console.log("[WEBRTC]", "LOUD SPEAKER ROUTE FORCED", { reason });
    } catch (err: any) {
      console.warn("[WEBRTC] Failed to force loud speaker route", err?.message || err);
    }
  }, []);

  const startInCallAudioRoute = useCallback((reason: string) => {
    try {
      if (!inCallAudioRouteActiveRef.current) {
        inCallAudioRouteActiveRef.current = true;
        InCallManager.start({ media: 'video' });
        console.log("[WEBRTC]", "INCALL MANAGER STARTED", { reason, media: 'video' });
      }

      forceLoudSpeakerRoute(reason);
      clearSpeakerRouteTimer();
      speakerRouteTimerRef.current = setTimeout(() => {
        forceLoudSpeakerRoute(`${reason}: delayed speaker reassert`);
      }, 500);
    } catch (err: any) {
      console.warn("[WEBRTC] Failed to start InCallManager", err?.message || err);
    }
  }, [clearSpeakerRouteTimer, forceLoudSpeakerRoute]);

  const stopInCallAudioRoute = useCallback((reason: string) => {
    clearSpeakerRouteTimer();
    if (!inCallAudioRouteActiveRef.current) return;

    try {
      InCallManager.stop({ busytone: '_DTMF_' });
      console.log("[WEBRTC]", "INCALL MANAGER STOPPED", { reason });
    } catch (err: any) {
      console.warn("[WEBRTC] Failed to stop InCallManager", err?.message || err);
    } finally {
      inCallAudioRouteActiveRef.current = false;
    }
  }, [clearSpeakerRouteTimer]);

  const applyLocalAudioMuteState = useCallback((muted: boolean, stream = localStreamRef.current) => {
    const audioTracks = stream?.getAudioTracks?.() || [];
    audioTracks.forEach((track: any) => {
      if (track?.readyState !== 'ended') {
        track.enabled = !muted;
      }
    });
    console.log("[WEBRTC]", "LOCAL AUDIO MUTE STATE APPLIED", {
      muted,
      audioTrackCount: audioTracks.length,
      audioTracks: audioTracks.map((track: any) => ({
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
      })),
    });
  }, []);

  const cameraLog = useCallback((eventName: string, data: Record<string, any> = {}) => {
    console.log("[WEBRTC]", eventName, {
      localStreamIsNull: !localStreamRef.current,
      localVideoTracks: getTrackDetails(localStreamRef.current).filter((track: any) => track.kind === 'video'),
      ...data,
    });
  }, []);

  const waitForLocalVideoTrack = useCallback(async (reason: string) => {
    if (hasLiveVideoTrack(localStreamRef.current)) {
      cameraLog("local video track detected", { reason });
      cameraLog("camera ready", { reason });
      return localStreamRef.current;
    }

    cameraLog("waiting for local video track", { reason, hasCameraInitPromise: !!cameraInitPromise.current });

    if (cameraInitPromise.current) {
      try {
        await cameraInitPromise.current;
      } catch (err: any) {
        cameraLog("waiting for local video track", {
          reason,
          cameraInitError: err?.message || String(err),
        });
      }
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < CAMERA_TRACK_WAIT_MS) {
      if (hasLiveVideoTrack(localStreamRef.current)) {
        cameraLog("local video track detected", { reason });
        cameraLog("camera ready", { reason });
        return localStreamRef.current;
      }
      await sleep(CAMERA_TRACK_POLL_MS);
    }

    cameraLog("waiting for local video track", { reason, timedOut: true });
    return null;
  }, [cameraLog]);

  const cleanupListeners = useCallback(() => {
    listenersRef.current.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch {
        // Firebase may already have released this listener.
      }
    });
    listenersRef.current = [];
  }, []);

  const cleanupNegotiationListeners = useCallback(() => {
    negotiationListenersRef.current.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch {
        // Firebase may already have released this listener.
      }
    });
    negotiationListenersRef.current = [];
  }, []);

  const closePc = useCallback((clearRemote = true, reason = "unspecified") => {
    console.log("[WEBRTC]", "closePc called", {
      reason,
      hasPeerConnection: !!pc.current,
      clearRemote,
      connectionState: (pc.current as any)?.connectionState ?? null,
      iceConnectionState: (pc.current as any)?.iceConnectionState ?? null,
      signalingState: (pc.current as any)?.signalingState ?? null,
      localTracks: getLocalTrackCount(pc.current, localStreamRef.current),
      remoteTracks: getRemoteTrackCount(pc.current, remoteStreamRef.current),
    });
    console.log("[WEBRTC]", "reason for close", { reason });
    if (pc.current) {
      // @ts-ignore react-native-webrtc event fields are writable at runtime.
      pc.current.ontrack = null;
      // @ts-ignore older native WebRTC builds can still emit addstream.
      pc.current.onaddstream = null;
      // @ts-ignore
      pc.current.onicecandidate = null;
      // @ts-ignore
      pc.current.onconnectionstatechange = null;
      // @ts-ignore
      pc.current.oniceconnectionstatechange = null;
      // @ts-ignore
      pc.current.onsignalingstatechange = null;
      pc.current.close();
      pc.current = null;
    }
    pendingCandidates.current = [];
    if (clearRemote) {
      remoteStreamRef.current = null;
      if (mountedRef.current) setRemoteStream(null);
    }
  }, []);

  const setRemote = useCallback((stream: any) => {
    remoteStreamRef.current = stream;
    if (pc.current) {
      (pc.current as any)._diagnosticRemoteStream = stream;
      webrtcLog("remoteStream stored", pc.current, {
        remoteStreamIsNull: !stream,
        remoteStreamURL: stream?.toURL?.() || null,
        remoteTrackDetails: getTrackDetails(stream),
      });
    }
    if (mountedRef.current) setRemoteStream(stream);
  }, []);

  const addCandidate = useCallback(async (candidateData: any, incomingOfferSessionId?: string) => {
    if (!candidateData) return;
    
    if (isAnswerInitializing.current) {
      console.log("[WEBRTC]", "candidate queued because answer initializing");
      pendingCandidates.current.push({ ...candidateData, _sessionId: incomingOfferSessionId });
      return;
    }

    const currentPc = pc.current;
    const isSessionMatch = incomingOfferSessionId === undefined || incomingOfferSessionId === offerSessionId.current;
    
    console.log("[WEBRTC_DIAGNOSTIC]", "candidate received", {
      targetPeerConnectionId: currentPcId.current,
      currentOfferSessionId: offerSessionId.current,
      incomingOfferSessionId: incomingOfferSessionId,
      isSessionMatch
    });

    if (currentPc?.remoteDescription && isSessionMatch) {
      webrtcLog("addIceCandidate", currentPc, {
        phase: "before",
        candidate: candidateData,
        candidateType: getCandidateType(candidateData),
      });
      await currentPc.addIceCandidate(new RTCIceCandidate(candidateData)).then(() => {
        webrtcLog("addIceCandidate", currentPc, {
          phase: "after",
          candidate: candidateData,
          candidateType: getCandidateType(candidateData),
        });
      }).catch((err) => {
        webrtcLog("addIceCandidate", currentPc, {
          phase: "error",
          candidate: candidateData,
          candidateType: getCandidateType(candidateData),
          error: err?.message || String(err),
        });
      });
    } else {
      webrtcLog("addIceCandidate", currentPc, {
        phase: "queued",
        candidate: candidateData,
        candidateType: getCandidateType(candidateData),
        reason: !isSessionMatch ? "session_mismatch" : "no_remote_description"
      });
      pendingCandidates.current.push({ ...candidateData, _sessionId: incomingOfferSessionId });
    }
  }, []);

  const flushPendingCandidates = useCallback(async () => {
    const toFlush = [...pendingCandidates.current];
    pendingCandidates.current = [];
    for (const candidate of toFlush) {
      const currentPc = pc.current;
      if (!currentPc) continue;
      webrtcLog("addIceCandidate", currentPc, {
        phase: "before",
        candidate,
        candidateType: getCandidateType(candidate),
      });
      console.log("[WEBRTC]", "candidate flushed to new peer connection");
      await currentPc.addIceCandidate(new RTCIceCandidate(candidate)).then(() => {
        webrtcLog("addIceCandidate", currentPc, {
          phase: "after",
          candidate,
          candidateType: getCandidateType(candidate),
        });
      }).catch((err) => {
        webrtcLog("addIceCandidate", currentPc, {
          phase: "error",
          candidate,
          candidateType: getCandidateType(candidate),
          error: err?.message || String(err),
        });
      });
    }
  }, []);

  const initPc = useCallback(async (colorToInit: 'w' | 'b', streamToUse: any, reason = "unspecified") => {
    const savedCandidates = [...pendingCandidates.current];
    console.log("[WEBRTC]", "pending candidates saved", { count: savedCandidates.length });
    closePc(true, `initPc replacing peer connection: ${reason}`);
    pendingCandidates.current = savedCandidates;
    console.log("[WEBRTC]", "pending candidates restored", { count: pendingCandidates.current.length });
    const activeSession = ++sessionId.current;
    currentPcId.current = Math.floor(Math.random() * 1000000);
    const newPc = new RTCPeerConnection(ICE_SERVERS);
    (newPc as any)._diagnosticLocalStream = streamToUse || null;
    (newPc as any)._diagnosticRemoteStream = remoteStreamRef.current || null;
    webrtcLog("RTCPeerConnection creation", newPc, { color: colorToInit, iceServers: ICE_SERVERS, pcId: currentPcId.current });
    pc.current = newPc;
    const initialConnectionState = (newPc as any).connectionState || "new";
    const initialIceConnectionState = (newPc as any).iceConnectionState || "new";
    connectionStateSequence.current = [initialConnectionState];
    iceConnectionStateSequence.current = [initialIceConnectionState];
    console.log("[WEBRTC]", "PC STATE", (newPc as any).connectionState);
    console.log("[WEBRTC]", "PC STATE TRANSITION", connectionStateSequence.current.join(" -> "));
    console.log("[WEBRTC]", "ICE STATE", (newPc as any).iceConnectionState);
    console.log("[WEBRTC]", "ICE STATE TRANSITION", iceConnectionStateSequence.current.join(" -> "));

    if (streamToUse) {
      streamToUse.getTracks().forEach((track: any) => {
        if (track.readyState !== 'ended') {
          newPc.addTrack(track, streamToUse);
        }
      });
    }

    // @ts-ignore
    newPc.ontrack = (event: any) => {
      if (activeSession !== sessionId.current) return;
      webrtcLog("ontrack", newPc, {
        trackId: event.track?.id || null,
        trackKind: event.track?.kind || null,
        trackEnabled: event.track?.enabled ?? null,
        trackMuted: event.track?.muted ?? null,
        trackReadyState: event.track?.readyState || null,
        eventStreamCount: event.streams?.length || 0,
        eventTrackCount: event.streams?.reduce?.((count: number, stream: any) => count + getTracks(stream).length, 0) || (event.track ? 1 : 0),
        eventStreamUrls: event.streams?.map?.((stream: any) => stream?.toURL?.() || null) || [],
      });
      
      if (event.track?.kind === "audio") {
        console.log("[WEBRTC]", "REMOTE AUDIO TRACK RECEIVED", {
          enabled: event.track.enabled,
          muted: event.track.muted,
          readyState: event.track.readyState,
        });
      }

      if (event.streams && event.streams.length > 0) {
        setRemote(event.streams[0]);
      } else if (event.track) {
        const currentStream = remoteStreamRef.current;
        if (!currentStream) {
          setRemote(new MediaStream([event.track]));
        } else {
          const hasTrack = currentStream.getTracks().some((t: any) => t.id === event.track.id);
          if (!hasTrack) {
            currentStream.addTrack(event.track);
            setRemote(new MediaStream(currentStream.getTracks()));
          }
        }
      }
    };

    // @ts-ignore older native WebRTC builds can emit addstream instead of track.
    newPc.onaddstream = (event: any) => {
      if (activeSession !== sessionId.current) return;
      webrtcLog("onaddstream", newPc, {
        streamId: event.stream?.id || null,
        eventTrackCount: getTracks(event.stream).length,
      });
      if (event.stream) {
        setRemote(event.stream);
      }
    };

    // @ts-ignore
    newPc.onicecandidate = (event: any) => {
      webrtcLog("onicecandidate", newPc, {
        candidate: event.candidate?.toJSON?.() || event.candidate || null,
        candidateType: getCandidateType(event.candidate),
      });
      if (activeSession === sessionId.current && event.candidate && rtcPath) {
        push(ref(db, `${rtcPath}/ice-${colorToInit}`), { ...event.candidate.toJSON(), _sessionId: offerSessionId.current });
      }
    };

    const closeFailedConnection = () => {
      const state = (newPc as any).connectionState || (newPc as any).iceConnectionState;
      if ((state === 'failed' || state === 'closed') && activeSession === sessionId.current) {
        closePc(true, `peer connection state became ${state}`);
      }
    };

    const handleConnectionState = () => {
      webrtcLog("connectionState changes", newPc, {});
      const state = (newPc as any).connectionState || "unknown";
      const previousState = connectionStateSequence.current[connectionStateSequence.current.length - 1];
      if (state !== previousState) {
        connectionStateSequence.current.push(state);
      }
      console.log("[WEBRTC]", "PC STATE", (newPc as any).connectionState);
      console.log("[WEBRTC]", "PC STATE TRANSITION", connectionStateSequence.current.join(" -> "));
      closeFailedConnection();
    };

    const handleIceConnectionState = () => {
      webrtcLog("iceConnectionState changes", newPc, {});
      const state = (newPc as any).iceConnectionState || "unknown";
      const previousState = iceConnectionStateSequence.current[iceConnectionStateSequence.current.length - 1];
      if (state !== previousState) {
        iceConnectionStateSequence.current.push(state);
      }
      console.log("[WEBRTC]", "ICE STATE", (newPc as any).iceConnectionState);
      console.log("[WEBRTC]", "ICE STATE TRANSITION", iceConnectionStateSequence.current.join(" -> "));
      closeFailedConnection();
    };

    const handleSignalingState = () => {
      webrtcLog("signalingState changes", newPc, {});
    };

    // @ts-ignore
    newPc.onconnectionstatechange = handleConnectionState;
    // @ts-ignore
    newPc.oniceconnectionstatechange = handleIceConnectionState;
    // @ts-ignore
    newPc.onsignalingstatechange = handleSignalingState;

    return newPc;
  }, [closePc, rtcPath, setRemote]);

  const doOffer = useCallback(async (reason = "unspecified") => {
    console.log("[WEBRTC]", "doOffer called", {
      reason,
      gameId,
      rtcPath,
      myColor,
      offerInProgress: offerInProgress.current,
      hasLocalStream: !!localStreamRef.current,
      localVideoTracks: getTrackDetails(localStreamRef.current).filter((track: any) => track.kind === 'video'),
    });
    console.log("[WEBRTC]", "reason for renegotiation", { reason });
    if (!gameId || !rtcPath || myColor !== 'w' || offerInProgress.current) return;
    offerInProgress.current = true;

    try {
      cleanupNegotiationListeners();
      pendingCandidates.current = [];
      const streamToUse = await waitForLocalVideoTrack("createOffer");
      if (!streamToUse) return;
      cameraLog("negotiation starting", { role: "offerer" });
      const newPc = await initPc('w', streamToUse, `doOffer: ${reason}`);
      const localVideoSenderCount = getLocalVideoSenderCount(newPc);
      if (localVideoSenderCount < 1) {
        cameraLog("waiting for local video track", {
          reason: "createOffer",
          peerConnectionLocalVideoSenders: localVideoSenderCount,
        });
        closePc(true, "createOffer blocked: peer connection has no local video sender");
        return;
        }

        console.log("[WEBRTC]", "targeted cleanup start");
        await set(ref(db, `${rtcPath}/ice-w`), null);
        await set(ref(db, `${rtcPath}/ice-b`), null);
        await set(ref(db, `${rtcPath}/answer`), null);
        console.log("[WEBRTC]", "targeted cleanup complete");

        const newOfferSessionId = Math.random().toString(36).substring(7);
      offerSessionId.current = newOfferSessionId;
      console.log("[WEBRTC_DIAGNOSTIC]", "new offer session created", { offerSessionId: newOfferSessionId, pcId: currentPcId.current });

      webrtcLog("createOffer", newPc, { phase: "before" });
      const offer = await newPc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
      webrtcLog("createOffer", newPc, { phase: "after", sdp: offer, sdpType: offer.type });
      webrtcLog("setLocalDescription", newPc, { phase: "before", description: offer, sdpType: offer.type });
      await newPc.setLocalDescription(offer);
      webrtcLog("setLocalDescription", newPc, { phase: "after", description: newPc.localDescription || offer, sdpType: offer.type });
      await set(ref(db, `${rtcPath}/offer`), { type: offer.type, sdp: offer.sdp, _sessionId: newOfferSessionId });

      const unsubscribeIce = onChildAdded(ref(db, `${rtcPath}/ice-b`), async (snap) => {
        const val = snap.val();
        await addCandidate(val, val._sessionId);
      });

      const unsubscribeAnswer = onValue(ref(db, `${rtcPath}/answer`), async (snap) => {
        const answer = snap.val();
        if (!answer || pc.current?.remoteDescription) return;
        webrtcLog("setRemoteDescription", pc.current, { phase: "before", description: answer, sdpType: answer.type });
        await pc.current?.setRemoteDescription(new RTCSessionDescription(answer));
        webrtcLog("setRemoteDescription", pc.current, { phase: "after", description: pc.current?.remoteDescription || answer, sdpType: answer.type });
        await flushPendingCandidates();
      });

      negotiationListenersRef.current.push(unsubscribeIce, unsubscribeAnswer);
    } catch (err) {
      console.warn('Failed to create WebRTC offer', err);
      closePc(true, "doOffer error");
    } finally {
      offerInProgress.current = false;
    }
  }, [addCandidate, cameraLog, cleanupNegotiationListeners, closePc, flushPendingCandidates, gameId, initPc, myColor, rtcPath, waitForLocalVideoTrack]);

  const doAnswer = useCallback(async (offerData: any) => {
    if (!rtcPath) return;
    const incomingSessionId = offerData._sessionId;
    console.log("[WEBRTC_DIAGNOSTIC]", "answer session starting", { offerSessionId: incomingSessionId, pcId: currentPcId.current });

    isAnswerInitializing.current = true;
    const streamToUse = await waitForLocalVideoTrack("createAnswer");
    if (!streamToUse) {
      isAnswerInitializing.current = false;
      return;
    }
    cameraLog("negotiation starting", { role: "answerer" });
    const newPc = await initPc('b', streamToUse, "doAnswer received Firebase offer");
    isAnswerInitializing.current = false;
    offerSessionId.current = incomingSessionId;
    
    console.log("[WEBRTC_DIAGNOSTIC]", "answer session pc initialized", { offerSessionId: incomingSessionId, pcId: currentPcId.current });

    const localVideoSenderCount = getLocalVideoSenderCount(newPc);
    if (localVideoSenderCount < 1) {
      cameraLog("waiting for local video track", {
        reason: "createAnswer",
        peerConnectionLocalVideoSenders: localVideoSenderCount,
      });
      closePc(true, "createAnswer blocked: peer connection has no local video sender");
      return;
    }
    
    webrtcLog("setRemoteDescription", newPc, { phase: "before", description: offerData, sdpType: offerData.type });
    await newPc.setRemoteDescription(new RTCSessionDescription(offerData));
    webrtcLog("setRemoteDescription", newPc, { phase: "after", description: newPc.remoteDescription || offerData, sdpType: offerData.type });
    await flushPendingCandidates();
    
    webrtcLog("createAnswer", newPc, { phase: "before" });
    const answer = await newPc.createAnswer();
    console.log("[WEBRTC]", "CREATE ANSWER SUCCESS");
    webrtcLog("createAnswer", newPc, { phase: "after", sdp: answer, sdpType: answer.type });
    webrtcLog("setLocalDescription", newPc, { phase: "before", description: answer, sdpType: answer.type });
    await newPc.setLocalDescription(answer);
    console.log("[WEBRTC]", "SET LOCAL ANSWER SUCCESS");
    webrtcLog("setLocalDescription", newPc, { phase: "after", description: newPc.localDescription || answer, sdpType: answer.type });
    await set(ref(db, `${rtcPath}/answer`), { type: answer.type, sdp: answer.sdp, _sessionId: incomingSessionId });
    console.log("[WEBRTC]", "ANSWER WRITTEN TO FIREBASE");
  }, [cameraLog, flushPendingCandidates, initPc, rtcPath, waitForLocalVideoTrack]);

  const signalRenegotiation = useCallback(async () => {
    if (!gameId || !myColor) return;
    console.log("[WEBRTC]", "reason for renegotiation", {
      reason: "signalRenegotiation",
      myColor,
      cameraEnabled,
      hasLocalStream: !!localStreamRef.current,
    });
    if (myColor === 'w') {
      await doOffer("signalRenegotiation: local camera state changed on white");
    } else {
      console.log("[WEBRTC]", "reason for renegotiation", {
        reason: "black wrote Firebase camera trigger for white to re-offer",
        gameId,
      });
      await set(ref(db, `games/${gameId}/cameras/trigger`), Date.now());
    }
  }, [cameraEnabled, doOffer, gameId, myColor]);

  const toggleCamera = useCallback(async () => {
    if (!gameId || !myColor) return;

    if (cameraEnabled) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track: any) => track.stop());
      }
      localStreamRef.current = null;
      cameraInitPromise.current = null;
      setLocalStream(null);
      setCameraEnabled(false);
      audioMutedRef.current = false;
      setAudioMuted(false);
      stopInCallAudioRoute("toggleCamera: camera disabled");
      console.log("[WEBRTC]", "reason for renegotiation", { reason: "toggleCamera: camera disabled" });
      await signalRenegotiation();
      return;
    }

    try {
      const cameraPromise = mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: 640,
          height: 480,
          frameRate: 24,
        },
        audio: true,
      });
      cameraInitPromise.current = cameraPromise;
      const stream = await cameraPromise;
      startInCallAudioRoute("toggleCamera: local media stream acquired");
      applyLocalAudioMuteState(audioMutedRef.current, stream);
      console.log("[WEBRTC]", "LOCAL AUDIO TRACKS", stream.getAudioTracks().length);
      stream.getAudioTracks().forEach((track: any) => {
        console.log("[WEBRTC]", "LOCAL AUDIO TRACK", {
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        });
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCameraEnabled(true);
      cameraLog("camera ready", {
        reason: "toggleCamera",
        hasLocalVideoTrack: hasLiveVideoTrack(stream),
      });
      console.log("[WEBRTC]", "reason for renegotiation", { reason: "toggleCamera: camera enabled" });
      await signalRenegotiation();
    } catch (err) {
      console.warn('Camera failed', err);
      setCameraEnabled(false);
      stopInCallAudioRoute("toggleCamera: camera failed");
    } finally {
      cameraInitPromise.current = null;
    }
  }, [applyLocalAudioMuteState, cameraEnabled, cameraLog, gameId, myColor, signalRenegotiation, startInCallAudioRoute, stopInCallAudioRoute]);

  const toggleAudioMute = useCallback(() => {
    const nextMuted = !audioMutedRef.current;
    audioMutedRef.current = nextMuted;
    setAudioMuted(nextMuted);
    applyLocalAudioMuteState(nextMuted);
  }, [applyLocalAudioMuteState]);

  useEffect(() => {
    mountedRef.current = true;
    if (!gameId || !myColor || !rtcPath) return;

    cleanupListeners();

    if (myColor === 'b') {
      let lastOfferSdp: string | null = null;

      const unsubscribeIce = onChildAdded(ref(db, `${rtcPath}/ice-w`), async (snap) => {
        const val = snap.val();
        await addCandidate(val, val._sessionId);
      });

      const unsubscribeOffer = onValue(ref(db, `${rtcPath}/offer`), async (snap) => {
        const offer = snap.val();
        if (!offer) {
          lastOfferSdp = null;
          pendingCandidates.current = [];
          return;
        }
        if (offer.sdp && offer.sdp === lastOfferSdp) return;
        lastOfferSdp = offer.sdp || null;

        try {
          await doAnswer(offer);
        } catch (err) {
          console.warn('Failed to answer WebRTC offer', err);
          closePc(true, "doAnswer error after Firebase offer");
        }
      });

      listenersRef.current.push(unsubscribeIce, unsubscribeOffer);
    }

    if (myColor === 'w') {
      let lastTrigger: any = null;
      const unsubscribeTrigger = onValue(ref(db, `games/${gameId}/cameras/trigger`), (snap) => {
          const v = snap.val();
          if (lastTrigger === null) { lastTrigger = v; return; }
          if (v && v !== lastTrigger) { 
            lastTrigger = v; 
            doOffer("Firebase cameras/trigger changed"); 
          }
      });

      listenersRef.current.push(unsubscribeTrigger);
    }

    return () => {
      cleanupListeners();
      cleanupNegotiationListeners();
      closePc(true, "useEffect cleanup: gameId/myColor/rtcPath changed");
    };
  }, [addCandidate, cleanupListeners, cleanupNegotiationListeners, closePc, doAnswer, doOffer, gameId, myColor, rtcPath]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      cleanupListeners();
      cleanupNegotiationListeners();
      closePc(true, "component unmount cleanup");
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track: any) => track.stop());
        localStreamRef.current = null;
      }
      stopInCallAudioRoute("component unmount cleanup");
      audioMutedRef.current = false;
    };
  }, [cleanupListeners, cleanupNegotiationListeners, closePc, stopInCallAudioRoute]);

  return { localStream, remoteStream, cameraEnabled, audioMuted, toggleCamera, toggleAudioMute };
}
