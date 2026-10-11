// Atelier model roles: what each model does, where it can come from, and the one-click starter kit.
// Pure data, shared by the server plugin, the agent tools, the setup kit and the terminal command.

/**
 * The owner's recommended brain on Hugging Face. One value; change it here (or set ATELIER_BRAIN_REPO)
 * when the repository is published. Users can always pick any other model.
 */
export const ARCITECH_BRAIN_REPO = process.env.ATELIER_BRAIN_REPO || 'arcitech/atelier-brain';

/** Every role Atelier knows. `kind` names the HTTP contract the role is reached through. */
export const ROLES = [
  {
    id: 'brain', name: 'Brain', kind: 'chat', required: true,
    purpose: 'The main assistant. It talks with you, plans the work and uses the tools. A model that can read images is best, so it can look at your sketches and screenshots.',
    whenMissing: 'Atelier cannot answer until a brain is connected.',
  },
  {
    id: 'vision', name: 'Vision', kind: 'chat',
    purpose: 'Looks at images for the brain. Only needed when your brain model cannot read images itself.',
    whenMissing: 'Without it, a text-only brain cannot look at images you attach.',
  },
  {
    id: 'stt', name: 'Speech to text', kind: 'transcribe',
    purpose: 'Turns your voice into text, so you can dictate to Vitruvius with the microphone button.',
    whenMissing: 'The microphone button stays hidden.',
  },
  {
    id: 'tts', name: 'Text to speech', kind: 'speech',
    purpose: 'Reads answers aloud with the "Read aloud" button under each reply.',
    whenMissing: 'The "Read aloud" button stays hidden.',
  },
  {
    id: 'embeddings', name: 'Embeddings', kind: 'embeddings',
    purpose: 'Search and recall: finds the right notes and documents in your project folder by meaning, not only by exact words.',
    whenMissing: 'The project search tool is not offered to the assistant.',
  },
  {
    id: 'image', name: 'Image generation', kind: 'image',
    purpose: 'Makes concept images for moodboards on the canvas. Optional.',
    whenMissing: 'Moodboards use colour and material cards only, with no generated images.',
  },
  {
    id: 'helper', name: 'Small helper', kind: 'chat',
    purpose: 'A small, fast model for quick side jobs. It appears in the model list, so you can pick it for quick chats and sub-agents.',
    whenMissing: 'Everything runs on the brain.',
  },
];

export const ROLE_IDS = ROLES.map(role => role.id);
export const roleById = id => ROLES.find(role => role.id === id);

/** The credential name a role's API key is stored under (in the harness's local credentials file). */
export const keyRefFor = id => `ATELIER_ROLE_${id.toUpperCase()}_KEY`;

/** Provider routes the roles plugin owns in the model settings. */
export const BRAIN_ROUTE = 'atelier-brain';
export const HELPER_ROUTE = 'atelier-helper';

const local = (port, path = '/v1') => `http://localhost:${port}${path}`;

/**
 * Ready-made starting points per role. Picking one fills the address and a model hint; nothing is installed.
 * `roles` lists the roles a server can fill.
 */
export const PRESETS = [
  {id: 'ollama', label: 'Ollama', baseURL: local(11434), roles: ['brain', 'vision', 'helper', 'embeddings'],
    note: 'Run "ollama serve", then "ollama pull <model>". Use the model name exactly as "ollama list" shows it.'},
  {id: 'lmstudio', label: 'LM Studio', baseURL: local(1234), roles: ['brain', 'vision', 'helper', 'embeddings'],
    note: 'Start the local server in LM Studio (Developer tab) and load a model.'},
  {id: 'llamacpp', label: 'llama.cpp server', baseURL: local(8080), roles: ['brain', 'vision', 'helper', 'embeddings'],
    note: 'llama-server -m model.gguf --jinja (add --mmproj for images, or --embeddings for an embeddings model).'},
  {id: 'vllm', label: 'vLLM', baseURL: local(8000), roles: ['brain', 'vision', 'helper', 'embeddings', 'stt'],
    note: 'vllm serve <model>. vLLM also serves Whisper-style speech-to-text models.'},
  {id: 'omniroute', label: 'OmniRoute (cloud)', baseURL: local(20128), roles: ['brain', 'vision', 'helper'], needsKey: true,
    note: 'Cloud models through OmniRoute on your computer: free tiers first, then your own keys. Your messages leave your computer.'},
  {id: 'whisper', label: 'whisper.cpp server', baseURL: local(8178), roles: ['stt'], model: 'whisper-1',
    note: 'whisper-server -m ggml-base-q8_0.bin --port 8178 --inference-path /v1/audio/transcriptions'},
  {id: 'speaches', label: 'Speaches', baseURL: local(8000), roles: ['stt', 'tts'],
    note: 'One OpenAI-compatible server for speech to text (faster-whisper) and text to speech (Kokoro, Piper).'},
  {id: 'kokoro', label: 'Kokoro-FastAPI', baseURL: local(8880), roles: ['tts'], model: 'kokoro', voice: 'af_bella',
    note: 'Kokoro text to speech with an OpenAI-compatible /v1/audio/speech route (Docker image remsky/kokoro-fastapi-cpu or -gpu).'},
  {id: 'comfyui', label: 'Image endpoint (OpenAI images API)', baseURL: local(8188, '/v1/images/generations'), roles: ['image'],
    note: 'Any server that answers the OpenAI images API with base64 images, such as a ComfyUI images bridge or LocalAI.'},
  {id: 'custom', label: 'Custom OpenAI-compatible', baseURL: '', roles: ROLE_IDS,
    note: 'Any other OpenAI-compatible address, on your computer or hosted.'},
];

/** "ARCITECH recommended" choices per role. The brain points at the owner's Hugging Face upload. */
export const RECOMMENDED = {
  brain: {label: 'ARCITECH recommended brain', source: `https://huggingface.co/${ARCITECH_BRAIN_REPO}`, repo: ARCITECH_BRAIN_REPO,
    note: 'The model Atelier is tuned for. It needs a 24 GB graphics card or more and runs on vLLM; see the model card. Any other model works too.'},
  vision: {label: 'Qwen3-VL (any size)', source: 'https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF',
    note: 'Only if your brain cannot read images. The 2B or 4B size is enough for looking at pictures.'},
  stt: {label: 'Whisper base (whisper.cpp)', source: 'https://huggingface.co/ggerganov/whisper.cpp',
    note: 'Small and fast on the processor. The "Set me up" kit can install it.'},
  tts: {label: 'Kokoro 82M', source: 'https://huggingface.co/hexgrad/Kokoro-82M',
    note: 'Light, natural voices (Apache-2.0). Run it with Kokoro-FastAPI or Speaches.'},
  embeddings: {label: 'EmbeddingGemma 2', source: 'https://huggingface.co/ggml-org/embeddinggemma-2-GGUF',
    note: 'Small multilingual embedder (Apache-2.0). Runs well on the processor. The "Set me up" kit installs it.'},
  image: {label: 'Your own ComfyUI', source: 'https://github.com/comfyanonymous/ComfyUI',
    note: 'Optional. Atelier calls an OpenAI images-style address; it does not install image models.'},
  helper: {label: 'Qwen3-VL 2B', source: 'https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF',
    note: 'Optional. A small model that answers quickly on almost any computer.'},
};

/** Honest guidance per graphics-memory tier. Speeds are rough; they depend on the card and the context length. */
export const TIERS = [
  {id: 'cpu', label: 'No graphics card (processor only)', brain: 'Qwen3-VL 2B (Q4)', context: 16384,
    advice: 'Works, but slowly: expect a few words per second and long waits on big requests. Use Vitruvius Zero, or a cloud brain through OmniRoute.'},
  {id: '8gb', label: '8 GB graphics card', brain: 'Qwen3-VL 4B (Q4)', context: 32768,
    advice: 'The minimum for a pleasant local experience. Good for design chat, images and short tasks; Vitruvius Zero is the better fit.'},
  {id: '12gb', label: '12 GB graphics card', brain: 'Qwen3-VL 8B (Q4)', context: 32768,
    advice: 'Noticeably better answers and tool use than 4B. Full Vitruvius works with a 32K context.'},
  {id: '16gb', label: '16 GB graphics card', brain: 'Qwen3-VL 8B (Q8)', context: 65536,
    advice: 'Higher-precision 8B with a longer context. A 14B-class model at Q4 also fits if you prefer it.'},
  {id: '24gb', label: '24 GB graphics card or more', brain: 'ARCITECH recommended brain (27B, 4-bit, vLLM)', context: 65536,
    advice: 'Runs the 27B brain Atelier is tuned for on vLLM: about 32K context on 24 GB (64K is tight), 128K on 32 GB. The kit installs the 8B model; follow the model card for the 27B brain.'},
];

/**
 * Pinned downloads for the "Set me up" kit, with the publisher's own SHA-256 (Hugging Face LFS ids and GitHub
 * release digests, read on 10 Oct 2026). Pinned revisions keep the kit reproducible; the kit refuses a file whose
 * checksum differs.
 */
const LLAMA_BUILD = 'b11552', WHISPER_BUILD = 'b5454';
const gh = (repo, tag, name) => `https://github.com/${repo}/releases/download/${tag}/${name}`;
const hf = (repo, rev, name) => `https://huggingface.co/${repo}/resolve/${rev}/${name}`;
export const FILES = {
  'llama-win-vulkan': {url: gh('ggml-org/llama.cpp', LLAMA_BUILD, `llama-${LLAMA_BUILD}-bin-win-vulkan-x64.zip`), size: 33473578, sha256: '83dc16325b532ba603034719e8377e28ca5093c5d4370141a6522f1a0250386c', unpack: 'llama', licence: 'MIT'},
  'llama-win-cpu': {url: gh('ggml-org/llama.cpp', LLAMA_BUILD, `llama-${LLAMA_BUILD}-bin-win-cpu-x64.zip`), size: 19528406, sha256: 'c00741179811ff903b515eae28bdeef1f47af6e81c49920c4e68b62954e056d6', unpack: 'llama', licence: 'MIT'},
  'llama-linux-vulkan': {url: gh('ggml-org/llama.cpp', LLAMA_BUILD, `llama-${LLAMA_BUILD}-bin-ubuntu-vulkan-x64.tar.gz`), size: 31790005, sha256: 'c7bb933f3584b73296fbadea6e0d6273ddb7907699ec59ef08d0bb59e0a8b997', unpack: 'llama', licence: 'MIT'},
  'llama-linux-cpu': {url: gh('ggml-org/llama.cpp', LLAMA_BUILD, `llama-${LLAMA_BUILD}-bin-ubuntu-x64.tar.gz`), size: 17824766, sha256: 'a45a6afda05d08028bd37998072ab602c96799bccde126835941623cb99bb727', unpack: 'llama', licence: 'MIT'},
  'whisper-win': {url: gh('ggml-org/whisper.cpp', WHISPER_BUILD, 'whisper-bin-x64.zip'), size: 8928640, sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb', unpack: 'whisper', licence: 'MIT'},
  'whisper-linux': {url: gh('ggml-org/whisper.cpp', WHISPER_BUILD, 'whisper-bin-ubuntu-x64.tar.gz'), size: 10364195, sha256: 'a72becf15d7917f990f6313867a52638b82b7f9ef237fb0c980dac56a135781c', unpack: 'whisper', licence: 'MIT'},
  'qwen3vl-2b-q4': {url: hf('Qwen/Qwen3-VL-2B-Instruct-GGUF', '52d6c8ffea26cc873ac5ad116f8631268d7eb503', 'Qwen3VL-2B-Instruct-Q4_K_M.gguf'), size: 1107409952, sha256: '089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae', licence: 'Apache-2.0'},
  'qwen3vl-2b-mmproj': {url: hf('Qwen/Qwen3-VL-2B-Instruct-GGUF', '52d6c8ffea26cc873ac5ad116f8631268d7eb503', 'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf'), size: 445053216, sha256: 'f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82', licence: 'Apache-2.0'},
  'qwen3vl-4b-q4': {url: hf('Qwen/Qwen3-VL-4B-Instruct-GGUF', '1cd86afb9a95c410a6038ab3b40d8b578c892266', 'Qwen3VL-4B-Instruct-Q4_K_M.gguf'), size: 2497281664, sha256: '66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a', licence: 'Apache-2.0'},
  'qwen3vl-4b-mmproj': {url: hf('Qwen/Qwen3-VL-4B-Instruct-GGUF', '1cd86afb9a95c410a6038ab3b40d8b578c892266', 'mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf'), size: 453974304, sha256: '30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d', licence: 'Apache-2.0'},
  'qwen3vl-8b-q4': {url: hf('Qwen/Qwen3-VL-8B-Instruct-GGUF', 'f982a07559d4a2f6c8744d840bf6fccab30eea96', 'Qwen3VL-8B-Instruct-Q4_K_M.gguf'), size: 5027784800, sha256: '67d1659bfe71b89d50b45a4ad1a9e5b997e5bb16ce5da66a6a6167abd569e9e2', licence: 'Apache-2.0'},
  'qwen3vl-8b-q8': {url: hf('Qwen/Qwen3-VL-8B-Instruct-GGUF', 'f982a07559d4a2f6c8744d840bf6fccab30eea96', 'Qwen3VL-8B-Instruct-Q8_0.gguf'), size: 8709519456, sha256: '0d264b3941185d00a74f75c4245521dae088ff1efc90ab8d1754e83f5844adb0', licence: 'Apache-2.0'},
  'qwen3vl-8b-mmproj': {url: hf('Qwen/Qwen3-VL-8B-Instruct-GGUF', 'f982a07559d4a2f6c8744d840bf6fccab30eea96', 'mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf'), size: 752289728, sha256: 'c6ba85508d82f42590e6eb77d5340369ab6fecf107a7561d809523d8aa5f3bfd', licence: 'Apache-2.0'},
  'embeddinggemma2-q8': {url: hf('ggml-org/embeddinggemma-2-GGUF', 'bfcd298762cc34d0357ece5ebdd31791a3a374d8', 'embeddinggemma-2-Q8_0.gguf'), size: 309855456, sha256: '2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135', licence: 'Apache-2.0'},
  'whisper-base-q8': {url: hf('ggerganov/whisper.cpp', '5359861c739e955e79d9a303bcbc70fb988958b1', 'ggml-base-q8_0.bin'), size: 81768585, sha256: 'c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9', licence: 'MIT'},
};

// ATELIER_KIT_FILES may name a JSON file of {id: {url, size, sha256}} entries that replace the pinned ones, for an
// office mirror or an offline installer. Checksums are still enforced.
if (process.env.ATELIER_KIT_FILES) {
  const {readFileSync} = await import('node:fs');
  for (const [id, entry] of Object.entries(JSON.parse(readFileSync(process.env.ATELIER_KIT_FILES, 'utf8')))) {
    if (FILES[id] && /^https?:\/\//.test(entry.url) && Number.isInteger(entry.size) && /^[a-f0-9]{64}$/.test(entry.sha256)) FILES[id] = {...FILES[id], ...entry};
  }
}

/** Brain model files per tier for the kit (model, vision projector, served name, context). */
export const KIT_BRAINS = {
  cpu: {model: 'qwen3vl-2b-q4', mmproj: 'qwen3vl-2b-mmproj', name: 'qwen3-vl-2b', context: 16384},
  '8gb': {model: 'qwen3vl-4b-q4', mmproj: 'qwen3vl-4b-mmproj', name: 'qwen3-vl-4b', context: 32768},
  '12gb': {model: 'qwen3vl-8b-q4', mmproj: 'qwen3vl-8b-mmproj', name: 'qwen3-vl-8b', context: 32768},
  '16gb': {model: 'qwen3vl-8b-q8', mmproj: 'qwen3vl-8b-mmproj', name: 'qwen3-vl-8b', context: 65536},
  '24gb': {model: 'qwen3vl-8b-q8', mmproj: 'qwen3vl-8b-mmproj', name: 'qwen3-vl-8b', context: 65536},
};

/** Loopback ports the kit's own servers listen on (chosen to avoid the usual 8000/8080/11434/1234). */
export const KIT_PORTS = {brain: 41901, embeddings: 41902, stt: 41903};
