// Pro Finish TTS Proxy v3.0
// Primary: ElevenLabs (Adam's cloned voice) | Fallback: OpenAI gpt-4o-mini-tts
// Adam McLemore — Pro Finish Custom Carpentry owner voice

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const ADAM_INSTRUCTIONS = 'Speak with a warm, natural Texas accent — relaxed and professional. ' +
  'You are the voice of Pro Finish Custom Carpentry in Big Spring, Texas. ' +
  'Sound knowledgeable about woodworking and home improvement. ' +
  'Be approachable and genuine, like talking to a trusted neighbor.';

// Adam McLemore's cloned voice — ElevenLabs Instant Voice Clone
// MUST use eleven_multilingual_v2 model (turbo/v3 returns empty audio for cloned voices)
const ELEVENLABS_VOICE_ID = 'raufF5ywygfXTaFj9LAa'; // Adam — cloned voice

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        service: 'profinish-tts-proxy',
        version: '3.0.0',
        primary: 'elevenlabs-adam-clone',
        fallback: 'openai-gpt-4o-mini-tts',
        voice: 'Adam McLemore (cloned)',
        voice_id: ELEVENLABS_VOICE_ID,
      }, { headers: CORS_HEADERS });
    }

    // Handle both /tts and /v1/audio/speech (OpenAI-compat) and /v1/text-to-speech/:voice_id (ElevenLabs-compat)
    const isTtsRoute = url.pathname === '/tts' ||
      url.pathname === '/v1/audio/speech' ||
      url.pathname.startsWith('/v1/text-to-speech/');

    if (isTtsRoute && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = body.text || body.input || '';
        if (!text || text.length > 4096) {
          return Response.json({ ok: false, error: 'text required (max 4096 chars)' }, { status: 400, headers: CORS_HEADERS });
        }

        const speed = body.speed || 1.0;
        const instructions = body.instructions || ADAM_INSTRUCTIONS;

        // Try ElevenLabs v3 first (primary)
        if (env.ELEVENLABS_API_KEY) {
          try {
            const voiceId = body.voice_id || ELEVENLABS_VOICE_ID;
            const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
              method: 'POST',
              headers: {
                'xi-api-key': env.ELEVENLABS_API_KEY,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                text: text,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                  stability: 0.6,
                  similarity_boost: 0.85,
                  style: 0.3,
                  use_speaker_boost: true,
                },
              }),
            });

            if (elRes.ok) {
              const audioBuffer = await elRes.arrayBuffer();
              if (audioBuffer.byteLength > 100) {
                return new Response(audioBuffer, {
                  headers: {
                    ...CORS_HEADERS,
                    'Content-Type': 'audio/mpeg',
                    'Content-Length': audioBuffer.byteLength.toString(),
                    'X-TTS-Provider': 'elevenlabs-v3',
                  },
                });
              }
            }
            // If ElevenLabs fails, fall through to OpenAI
            console.log(JSON.stringify({ level: 'warn', service: 'profinish-tts-proxy', msg: 'ElevenLabs failed, falling back to OpenAI', status: elRes.status, ts: new Date().toISOString() }));
          } catch (elErr) {
            console.log(JSON.stringify({ level: 'warn', service: 'profinish-tts-proxy', msg: 'ElevenLabs error, falling back to OpenAI', error: elErr.message, ts: new Date().toISOString() }));
          }
        }

        // Fallback: OpenAI gpt-4o-mini-tts with Nova voice
        if (env.OPENAI_API_KEY) {
          const voice = body.voice || 'nova';
          const format = body.response_format || 'mp3';

          const openaiRes = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini-tts',
              voice,
              input: text,
              instructions,
              response_format: format,
              speed,
            }),
          });

          if (openaiRes.ok) {
            const audioBuffer = await openaiRes.arrayBuffer();
            const contentType = format === 'mp3' ? 'audio/mpeg' : format === 'wav' ? 'audio/wav' : `audio/${format}`;

            return new Response(audioBuffer, {
              headers: {
                ...CORS_HEADERS,
                'Content-Type': contentType,
                'Content-Length': audioBuffer.byteLength.toString(),
                'X-TTS-Provider': 'openai-nova',
              },
            });
          }

          const err = await openaiRes.text();
          return Response.json({ ok: false, error: `TTS error: ${openaiRes.status}`, detail: err }, { status: 502, headers: CORS_HEADERS });
        }

        return Response.json({ ok: false, error: 'No TTS provider configured' }, { status: 503, headers: CORS_HEADERS });
      } catch (e) {
        return Response.json({ ok: false, error: e.message }, { status: 500, headers: CORS_HEADERS });
      }
    }

    return Response.json({
      service: 'Pro Finish TTS Proxy',
      version: '3.0.0',
      primary: 'ElevenLabs (Adam clone, eleven_multilingual_v2)',
      fallback: 'OpenAI gpt-4o-mini-tts',
      endpoints: {
        'POST /tts': 'Text to speech (ElevenLabs primary, OpenAI fallback)',
        'POST /v1/audio/speech': 'OpenAI-compatible endpoint',
        'POST /v1/text-to-speech/:voice_id': 'ElevenLabs-compatible endpoint',
        'GET /health': 'Health check',
      },
      params: {
        text: 'string (required) — text to speak (or "input" for OpenAI compat)',
        voice_id: 'string (optional) — ElevenLabs voice ID',
        voice: 'string (optional, default: nova) — OpenAI voice name',
        speed: 'number (optional, default: 0.95)',
        instructions: 'string (optional) — voice style instructions',
      },
    }, { headers: CORS_HEADERS });
  },
};
