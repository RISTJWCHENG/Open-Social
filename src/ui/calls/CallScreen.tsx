/**
 * Calls on screen: a card for an incoming call (accept / decline), and the
 * call itself: the friend's video full size (or their photo for voice), your
 * camera in a corner, the time, and mute, camera and hang-up buttons.
 */
import { useEffect, useRef, useState } from 'react';
import type { CallState } from '../../core/calls/calls';
import { Avatar } from '../Avatar';
import { MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon, VideoIcon, VideoOffIcon } from '../icons';
import { formatDuration } from '../voice/recorder';
import { startTone } from './ringer';

interface Props {
  call: CallState;
  name: string;
  avatar?: string;
  onAccept: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
}

/** Plays a MediaStream in a <video> or <audio> element. */
function useStream<T extends HTMLMediaElement>(stream: MediaStream | undefined) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== (stream ?? null)) ref.current.srcObject = stream ?? null;
  }, [stream]);
  return ref;
}

export function CallScreen({ call, name, avatar, onAccept, onHangUp, onToggleMute, onToggleCamera }: Props) {
  const remoteVideo = useStream<HTMLVideoElement>(call.remote);
  const remoteAudio = useStream<HTMLAudioElement>(call.remote);
  const localVideo = useStream<HTMLVideoElement>(call.local);
  const [, tick] = useState(0);
  const video = call.kind === 'video';
  const incoming = call.direction === 'in' && call.phase === 'ringing';

  // Ring while an incoming call waits; ringback while calling.
  useEffect(() => {
    if (call.phase !== 'ringing') return;
    return startTone(call.direction === 'in' ? 'ring' : 'ringback');
  }, [call.phase, call.direction]);

  // The timer.
  useEffect(() => {
    if (call.phase !== 'active') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [call.phase]);

  if (incoming) {
    return (
      <div className="call-incoming" role="alertdialog" aria-label={`Incoming ${call.kind} call from ${name}`}>
        <Avatar name={name} className="avatar-56" src={avatar} />
        <div className="call-incoming-text">
          <strong>{name}</strong>
          <span>Incoming {call.kind} call…</span>
        </div>
        <button type="button" className="call-round call-decline" aria-label="Decline" title="Decline" onClick={onHangUp}>
          <PhoneOffIcon />
        </button>
        <button type="button" className="call-round call-accept" aria-label="Accept" title="Accept" onClick={onAccept}>
          {video ? <VideoIcon /> : <PhoneIcon />}
        </button>
      </div>
    );
  }

  const status =
    call.phase === 'active'
      ? formatDuration(Date.now() - (call.connectedAt ?? Date.now()))
      : call.phase === 'connecting'
        ? 'Connecting…'
        : 'Calling…';
  const showRemoteVideo = video && call.phase === 'active' && !!call.remote?.getVideoTracks().length;

  return (
    <div className={`call-screen ${video ? 'is-video' : 'is-voice'}`} role="dialog" aria-label={`${call.kind === 'video' ? 'Video' : 'Voice'} call with ${name}`}>
      <video ref={remoteVideo} className="call-remote" autoPlay playsInline hidden={!showRemoteVideo} />
      {!video && <audio ref={remoteAudio} autoPlay />}
      {!showRemoteVideo && (
        <div className="call-who">
          <Avatar name={name} className="avatar-96" src={avatar} />
        </div>
      )}
      <div className="call-top">
        <strong>{name}</strong>
        <span aria-live="polite">{status}</span>
      </div>
      {video && call.local && (
        <video ref={localVideo} className={`call-local ${call.cameraOff ? 'off' : ''}`} autoPlay playsInline muted aria-label="Your camera" />
      )}
      <div className="call-controls">
        <button
          type="button"
          className={`call-round ${call.muted ? 'is-off' : ''}`}
          aria-label={call.muted ? 'Unmute' : 'Mute'}
          aria-pressed={call.muted}
          title={call.muted ? 'Unmute' : 'Mute'}
          onClick={onToggleMute}
        >
          {call.muted ? <MicOffIcon /> : <MicIcon />}
        </button>
        {video && (
          <button
            type="button"
            className={`call-round ${call.cameraOff ? 'is-off' : ''}`}
            aria-label={call.cameraOff ? 'Turn camera on' : 'Turn camera off'}
            aria-pressed={call.cameraOff}
            title={call.cameraOff ? 'Turn camera on' : 'Turn camera off'}
            onClick={onToggleCamera}
          >
            {call.cameraOff ? <VideoOffIcon /> : <VideoIcon />}
          </button>
        )}
        <button type="button" className="call-round call-decline" aria-label="Hang up" title="Hang up" onClick={onHangUp}>
          <PhoneOffIcon />
        </button>
      </div>
    </div>
  );
}
