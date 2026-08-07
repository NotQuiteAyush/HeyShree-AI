package ai.shree.companion.voice

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import androidx.core.content.ContextCompat
import ai.shree.companion.protocol.EncryptedSocket
import ai.shree.companion.protocol.CompanionData
import ai.shree.companion.protocol.PairingCredentials
import ai.shree.companion.protocol.ProtocolCrypto
import ai.shree.companion.protocol.WireMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean

class VoiceSession(private val context: Context, private val credentials: PairingCredentials) {
    private sealed interface PlaybackEvent {
        data class Audio(val pcm: ByteArray) : PlaybackEvent
        data object TurnComplete : PlaybackEvent
    }

    val status = MutableStateFlow("idle")
    val transcript = MutableStateFlow("")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var recording: Job? = null
    private var recorder: AudioRecord? = null
    private var player: AudioTrack? = null
    private var echoCanceler: AcousticEchoCanceler? = null
    private var noiseSuppressor: NoiseSuppressor? = null
    private val stopped = AtomicBoolean(false)
    // Android echo cancellation varies considerably between devices. Keep the
    // live microphone open, but never upload frames while SHREE's own response
    // is queued or audible through the phone speaker.
    private val playbackGate = VoicePlaybackGate()
    private val playerLock = Any()
    private var writtenPlaybackFrames = 0L
    private val playbackQueue = Channel<PlaybackEvent>(128)
    private val socket = EncryptedSocket(credentials, "live", "voice_hello") { message, _ ->
        CompanionData.consume(message)
        when {
            message.interrupted == true -> interruptPlayback()
            message.type == "session_replaced" -> {
                recording?.cancel()
                interruptPlayback()
                status.value = "error: ${message.text ?: "Voice is active on another SHREE device"}"
            }
            message.audio != null -> {
                playbackGate.responseAudioStarted()
                val pcm = ProtocolCrypto.decodeAudio(message.audio)
                require(pcm.isNotEmpty() && pcm.size % 2 == 0) { "SHREE returned an incomplete audio frame" }
                if (playbackQueue.trySend(PlaybackEvent.Audio(pcm)).isFailure) error("Voice playback could not keep up with the response")
            }
            message.text != null -> transcript.value = message.text
            message.error != null -> status.value = "error: ${message.error}"
            message.type == "turn_complete" -> {
                if (playbackQueue.trySend(PlaybackEvent.TurnComplete).isFailure) error("Voice playback ended unexpectedly")
            }
        }
    }

    init {
        scope.launch {
            socket.state.collect { next ->
                if (next.startsWith("error")) status.value = next
            }
        }
        scope.launch {
            for (event in playbackQueue) {
                when (event) {
                    is PlaybackEvent.Audio -> runCatching { playChunk(event.pcm) }.onFailure { error ->
                        if (!stopped.get()) status.value = "error: ${error.message ?: "Voice playback failed"}"
                    }
                    PlaybackEvent.TurnComplete -> finishPlaybackTurn()
                }
            }
        }
    }

    fun start() {
        check(!stopped.get()) { "This voice session has ended" }
        check(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            "Microphone permission is required"
        }
        socket.connect()
        recording?.cancel()
        recording = scope.launch {
            try {
                while (socket.state.value == "connecting" && isActive) delay(30)
                check(socket.state.value == "connected") { socket.state.value.substringAfter(":", "The PC voice link did not connect").trim() }
                val minimum = AudioRecord.getMinBufferSize(16_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
                check(minimum > 0) { "This microphone does not support 16 kHz voice capture" }
                val input = AudioRecord(
                    MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                    16_000,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    maxOf(minimum, 4096),
                )
                check(input.state == AudioRecord.STATE_INITIALIZED) { "The selected microphone could not be initialized" }
                recorder = input
                if (AcousticEchoCanceler.isAvailable()) {
                    echoCanceler = AcousticEchoCanceler.create(input.audioSessionId)?.apply { enabled = true }
                }
                if (NoiseSuppressor.isAvailable()) {
                    noiseSuppressor = NoiseSuppressor.create(input.audioSessionId)?.apply { enabled = true }
                }
                input.startRecording()
                check(input.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "The microphone did not start recording" }
                status.value = "listening"
                val buffer = ByteArray(1280)
                while (isActive) {
                    val read = input.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
                    if (read > 1 && playbackGate.mayUploadMicrophone()) {
                        val completePcmBytes = read - (read % 2)
                        val sent = socket.send(
                            WireMessage(
                                type = "audio",
                                audio = ProtocolCrypto.audioBase64(buffer.copyOf(completePcmBytes)),
                            ),
                        )
                        if (!sent) error("The encrypted voice connection was interrupted")
                    } else if (read < 0) {
                        error("Microphone capture failed with Android audio error $read")
                    }
                }
            } catch (error: Throwable) {
                if (isActive) status.value = "error: ${error.message ?: "Microphone capture failed"}"
            }
        }
    }

    fun stop() {
        if (!stopped.compareAndSet(false, true)) return
        playbackGate.responsePlaybackFinished()
        recording?.cancel(); recording = null
        runCatching { recorder?.stop() }
        echoCanceler?.release(); echoCanceler = null
        noiseSuppressor?.release(); noiseSuppressor = null
        recorder?.release(); recorder = null
        socket.send(WireMessage(type = "audio_stream_end")); socket.close()
        playbackQueue.close()
        synchronized(playerLock) {
            runCatching { player?.pause() }
            runCatching { player?.flush() }
            player?.release(); player = null
        }
        status.value = "idle"
    }

    private fun playChunk(pcm: ByteArray) = synchronized(playerLock) {
        if (stopped.get()) return@synchronized
        val minimum = AudioTrack.getMinBufferSize(24_000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minimum > 0) { "This device does not support SHREE voice playback" }
        val output = player ?: AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(24_000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setBufferSizeInBytes(maxOf(minimum, 16_384))
            .setTransferMode(AudioTrack.MODE_STREAM).build().also {
                check(it.state == AudioTrack.STATE_INITIALIZED) { "The phone speaker could not be initialized" }
                it.play()
                writtenPlaybackFrames = 0L
                player = it
            }
        status.value = "speaking"
        val written = output.write(pcm, 0, pcm.size, AudioTrack.WRITE_BLOCKING)
        check(written >= 0) { "Voice playback failed with Android audio error $written" }
        writtenPlaybackFrames += written / 2L
    }

    private suspend fun finishPlaybackTurn() {
        val output: AudioTrack?
        val targetFrames: Long
        synchronized(playerLock) {
            output = player
            targetFrames = writtenPlaybackFrames
        }
        if (output != null && targetFrames > 0L) {
            val deadline = System.currentTimeMillis() + 12_000L
            while (!stopped.get() && System.currentTimeMillis() < deadline) {
                val playedFrames = Integer.toUnsignedLong(output.playbackHeadPosition)
                if (playedFrames >= targetFrames) break
                delay(20)
            }
            // Suppress the short acoustic tail that remains in the microphone
            // after the final speaker sample on many phones.
            delay(180)
        }
        playbackGate.responsePlaybackFinished()
        if (!stopped.get()) status.value = "listening"
    }

    private fun interruptPlayback() {
        while (playbackQueue.tryReceive().isSuccess) { /* discard queued response audio */ }
        synchronized(playerLock) {
            player?.let { output ->
                runCatching { output.pause() }
                runCatching { output.flush() }
                runCatching { output.play() }
                writtenPlaybackFrames = Integer.toUnsignedLong(output.playbackHeadPosition)
            }
        }
        playbackGate.responsePlaybackFinished()
        if (!stopped.get()) status.value = "listening"
    }

    fun destroy() { stop(); socket.destroy(); scope.cancel() }
}
