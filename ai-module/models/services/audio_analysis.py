import numpy as np
import sounddevice as sd
import librosa
from scipy import signal
from datetime import datetime
from typing import Dict, List, Optional
import threading
import queue

class AudioAnalyzer:
    def __init__(self, sample_rate: int = 44100, channels: int = 1):
        """
        Initialize audio analyzer for voice detection
        
        Args:
            sample_rate: Audio sample rate
            channels: Number of audio channels
        """
        self.sample_rate = sample_rate
        self.channels = channels
        self.audio_queue = queue.Queue()
        self.is_recording = False
        self.audio_thread = None
        
        # Voice detection parameters
        self.silence_threshold = 0.02
        self.min_voice_duration = 0.5  # seconds
        self.max_pause_duration = 2.0  # seconds
        
        # Audio history
        self.audio_history = []
        self.max_history = 100
        
        # Voice activity detection
        self.voice_segments = []
        self.current_segment = None
        
    def start_recording(self):
        """Start audio recording in background thread"""
        if self.is_recording:
            return
        
        self.is_recording = True
        self.audio_thread = threading.Thread(target=self._record_audio)
        self.audio_thread.daemon = True
        self.audio_thread.start()
    
    def stop_recording(self):
        """Stop audio recording"""
        self.is_recording = False
        if self.audio_thread:
            self.audio_thread.join(timeout=1.0)
    
    def _record_audio(self):
        """Background thread for audio recording"""
        def callback(indata, frames, time, status):
            if status:
                print(f"Audio error: {status}")
            self.audio_queue.put(indata.copy())
        
        try:
            with sd.InputStream(callback=callback,
                              channels=self.channels,
                              samplerate=self.sample_rate,
                              dtype='float32'):
                while self.is_recording:
                    sd.sleep(100)
        except Exception as e:
            print(f"Audio recording error: {e}")
    
    def analyze_audio_chunk(self, audio_data: np.ndarray) -> Dict:
        """
        Analyze audio chunk for voice activity
        
        Args:
            audio_data: Audio samples as numpy array
            
        Returns:
            Dictionary with audio analysis results
        """
        analysis = {
            "voice_detected": False,
            "confidence": 0.0,
            "volume_level": 0.0,
            "is_speaking": False,
            "background_noise": 0.0,
            "pitch": 0.0,
            "timestamp": datetime.now().isoformat()
        }
        
        if audio_data.size == 0:
            return analysis
        
        # Calculate volume (RMS)
        rms = np.sqrt(np.mean(audio_data**2))
        analysis["volume_level"] = float(rms)
        
        # Detect voice activity
        is_voice = rms > self.silence_threshold
        analysis["voice_detected"] = is_voice
        analysis["confidence"] = min(rms / 0.1, 1.0)  # Normalize
        
        # Simple pitch detection (using zero-crossing rate)
        zcr = np.mean(librosa.feature.zero_crossing_rate(audio_data.flatten()))
        analysis["pitch"] = float(zcr)
        
        # Background noise estimation
        if not is_voice:
            analysis["background_noise"] = float(rms)
        
        # Update voice segments
        self._update_voice_segments(is_voice, rms)
        
        # Check if currently speaking
        analysis["is_speaking"] = self._check_speaking_status()
        
        # Store in history
        self.audio_history.append({
            "timestamp": datetime.now(),
            "volume": rms,
            "is_voice": is_voice,
            "speaking": analysis["is_speaking"]
        })
        
        if len(self.audio_history) > self.max_history:
            self.audio_history.pop(0)
        
        return analysis
    
    def _update_voice_segments(self, is_voice: bool, volume: float):
        """Update voice segments for pattern analysis"""
        current_time = datetime.now()
        
        if is_voice:
            if self.current_segment is None:
                # Start new segment
                self.current_segment = {
                    "start": current_time,
                    "end": None,
                    "max_volume": volume,
                    "duration": 0.0
                }
            else:
                # Update existing segment
                self.current_segment["max_volume"] = max(
                    self.current_segment["max_volume"], volume
                )
                self.current_segment["duration"] = (
                    current_time - self.current_segment["start"]
                ).total_seconds()
        else:
            if self.current_segment is not None:
                # End current segment
                self.current_segment["end"] = current_time
                self.voice_segments.append(self.current_segment.copy())
                
                # Keep only recent segments
                if len(self.voice_segments) > 20:
                    self.voice_segments.pop(0)
                
                self.current_segment = None
    
    def _check_speaking_status(self) -> bool:
        """Check if currently speaking based on recent voice segments"""
        if not self.voice_segments and self.current_segment is None:
            return False
        
        # Check if we have a current segment
        if self.current_segment is not None:
            return self.current_segment["duration"] > self.min_voice_duration
        
        # Check last segment
        if self.voice_segments:
            last_segment = self.voice_segments[-1]
            time_since_end = (datetime.now() - last_segment["end"]).total_seconds()
            
            # Still considered speaking if recent segment ended < max_pause_duration ago
            return time_since_end < self.max_pause_duration
        
        return False
    
    def analyze_speaking_patterns(self, window_minutes: float = 1.0) -> Dict:
        """
        Analyze speaking patterns over time window
        
        Args:
            window_minutes: Time window in minutes
            
        Returns:
            Dictionary with speaking pattern analysis
        """
        if not self.voice_segments:
            return {
                "suspicious_pattern": False,
                "total_speaking_time": 0.0,
                "segment_count": 0,
                "avg_segment_duration": 0.0,
                "confidence": 0.0
            }
        
        # Get segments within time window
        cutoff_time = datetime.now() - np.timedelta64(int(window_minutes * 60), 's')
        
        recent_segments = [
            seg for seg in self.voice_segments
            if seg["end"] is not None and seg["end"] > cutoff_time
        ]
        
        if self.current_segment:
            recent_segments.append(self.current_segment)
        
        if not recent_segments:
            return {
                "suspicious_pattern": False,
                "total_speaking_time": 0.0,
                "segment_count": 0,
                "avg_segment_duration": 0.0,
                "confidence": 0.0
            }
        
        # Calculate statistics
        total_duration = sum(
            seg["duration"] for seg in recent_segments 
            if "duration" in seg
        )
        segment_count = len(recent_segments)
        avg_duration = total_duration / segment_count if segment_count > 0 else 0
        
        # Check for suspicious patterns
        # 1. Too much total speaking time
        suspicious_total = total_duration > (window_minutes * 60 * 0.3)  # >30% of time
        
        # 2. Too many short segments (possible communication)
        short_segments = sum(1 for seg in recent_segments 
                           if seg.get("duration", 0) < 1.0)  # <1 second segments
        suspicious_fragmentation = short_segments > (segment_count * 0.5)  # >50% short
        
        suspicious_pattern = suspicious_total or suspicious_fragmentation
        
        return {
            "suspicious_pattern": suspicious_pattern,
            "total_speaking_time": total_duration,
            "segment_count": segment_count,
            "avg_segment_duration": avg_duration,
            "short_segment_count": short_segments,
            "suspicious_total": suspicious_total,
            "suspicious_fragmentation": suspicious_fragmentation,
            "confidence": min(total_duration / (window_minutes * 60), 1.0)
        }
    
    def get_recent_audio(self, max_samples: int = 44100) -> Optional[np.ndarray]:
        """Get recent audio samples from queue"""
        samples = []
        
        while not self.audio_queue.empty() and len(samples) < max_samples:
            try:
                chunk = self