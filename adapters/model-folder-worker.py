"""Known local SDK recipes behind the shared JSONL boundary; no HTTP gateway."""
import argparse
import base64
import contextlib
import io
import json
import os
import re
from pathlib import Path
import sys
import faulthandler

from worker_common import WorkerError

parser = argparse.ArgumentParser()
parser.add_argument('--model-type', choices=['kokoro', 'qwen3', 'f5', 'voxcpm', 'cosyvoice'], required=True)
for key in ['model-dir', 'sdk-path', 'vocoder-dir', 'ref-audio', 'prompt-text', 'voice']:
    parser.add_argument('--' + key, default='')
parser.add_argument('--device', choices=['auto', 'cpu', 'cuda'], default='auto')
parser.add_argument('--language', default='Chinese')
parser.add_argument('--speed', type=float, default=1)
args = parser.parse_args()
if os.environ.get('DSH_TTS_DEBUG') == '1':
    faulthandler.enable()
    faulthandler.dump_traceback_later(60, repeat=True)
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
if args.device == 'cpu':
    os.environ['CUDA_VISIBLE_DEVICES'] = ''
folder = Path(args.model_dir).resolve()
model = None
loaded = False
voices = []
pipelines = {}


def load():
    global model, voices, np, sf, torch, device, loaded
    if loaded:
        return
    print('Loading local model: ' + args.model_type, file=sys.stderr, flush=True)
    try:
        import numpy as np
        import soundfile as sf
        import torch
        torch.set_num_threads(4)
        device = ('cuda' if torch.cuda.is_available() else 'cpu') if args.device == 'auto' else args.device
        if device == 'cuda' and not torch.cuda.is_available():
            raise WorkerError('DEVICE', '当前 Python 环境无法使用 CUDA，请选择正确环境或 CPU。')
        if args.model_type in ['f5', 'voxcpm', 'cosyvoice']:
            if not Path(args.ref_audio).is_file() or not args.prompt_text.strip():
                raise WorkerError('REFERENCE', '该模型需要参考音频及对应原文，请在音色设置中填写。')
        if args.model_type == 'kokoro':
            from kokoro import KModel
            model = KModel(repo_id='hexgrad/Kokoro-82M', config=str(folder / 'config.json'), model=str(folder / 'kokoro-v1_0.pth')).to(device).eval()
            voices = sorted(p.stem for p in (folder / 'voices').glob('*.pt') if p.is_file() and re.fullmatch(r'[abefhijpz][fm]_[\w-]+', p.stem, re.ASCII))
        elif args.model_type == 'qwen3':
            from qwen_tts import Qwen3TTSModel
            model = Qwen3TTSModel.from_pretrained(str(folder), device_map='cuda:0' if device == 'cuda' else 'cpu', dtype=torch.bfloat16 if device == 'cuda' else torch.float32, attn_implementation='sdpa', local_files_only=True)
            voices = model.get_supported_speakers()
        elif args.model_type == 'f5':
            from f5_tts.api import F5TTS
            if not (Path(args.vocoder_dir) / 'config.yaml').is_file():
                raise WorkerError('VOCODER', '请选择已下载的 Vocos 声码器文件夹。')
            model = F5TTS(ckpt_file=str(folder / 'model_1250000.safetensors'), vocab_file=str(folder / 'vocab.txt'), vocoder_local_path=args.vocoder_dir, device=device)
        elif args.model_type == 'voxcpm':
            from voxcpm import VoxCPM
            model = VoxCPM.from_pretrained(str(folder), load_denoiser=False, optimize=False, local_files_only=True)
        else:
            project = Path(args.sdk_path)
            if not (project / 'cosyvoice/cli/cosyvoice.py').is_file():
                raise WorkerError('SDK', '请选择已安装的 CosyVoice 源码文件夹。')
            sys.path.insert(0, str(project))
            sys.path.insert(0, str(project / 'third_party/Matcha-TTS'))
            from cosyvoice.dataset import processor
            from cosyvoice.cli.cosyvoice import AutoModel
            # Official CosyVoice chooses CUDA when available. Avoid pretending that a CPU override applied.
            if args.device == 'cpu' and torch.cuda.is_available():
                raise WorkerError('DEVICE', '此 CosyVoice SDK 会自动选择 CUDA；请使用自动或 CUDA。')
            model = AutoModel(model_dir=str(folder), load_trt=False, load_vllm=False, fp16=False)
    except ImportError as exc:
        raise WorkerError('DEPENDENCY', '所选 Python 缺少模型依赖：' + str(exc)) from exc
    if not voices:
        if args.model_type in ['kokoro', 'qwen3']:
            raise WorkerError('VOICE', '没有找到可用预设音色，请检查模型的音色文件。')
        voices = ['default']
    loaded = True
    if os.environ.get('DSH_TTS_DEBUG') == '1':
        faulthandler.cancel_dump_traceback_later()


def synthesize(text, voice):
    if voice not in voices:
        raise WorkerError('VOICE', '所选音色不在当前模型的音色列表中。')
    if args.model_type == 'kokoro':
        from kokoro import KPipeline
        lang = voice[0]
        if lang not in pipelines:
            pipelines[lang] = KPipeline(lang_code=lang, repo_id='hexgrad/Kokoro-82M', model=model)
        chunks = [audio.numpy() for _, _, audio in pipelines[lang](text, voice=str(folder / 'voices' / (voice + '.pt')), speed=args.speed)]
        return np.concatenate(chunks), 24000
    if args.model_type == 'qwen3':
        waves, rate = model.generate_custom_voice(text=text, language=args.language, speaker=voice)
        return waves[0], rate
    if args.model_type == 'f5':
        wave, rate, _ = model.infer(ref_file=args.ref_audio, ref_text=args.prompt_text, gen_text=text, nfe_step=16, speed=args.speed, seed=42)
        return wave, rate
    if args.model_type == 'voxcpm':
        return model.generate(text=text, prompt_wav_path=args.ref_audio, prompt_text=args.prompt_text, inference_timesteps=10, normalize=False, denoise=False), model.tts_model.sample_rate
    prompt = 'You are a helpful assistant.<|endofprompt|>' + args.prompt_text
    chunks = [item['tts_speech'].squeeze().cpu().numpy() for item in model.inference_zero_shot(text, prompt, args.ref_audio, stream=False, speed=args.speed)]
    return np.concatenate(chunks), model.sample_rate


def handle(request):
    # Reserve stdout exclusively for JSONL, including SDK import/loading logs.
    with contextlib.redirect_stdout(sys.stderr):
        action = request.get('action')
        if action not in ['health', 'voices', 'synthesize']:
            raise WorkerError('ACTION', '不支持的模型操作。')
        load()
        if action == 'health':
            return {'ready': True, 'status': 'ready', 'device': device}
        if action == 'voices':
            return {'voices': [{'id': v, 'name': v} for v in voices]}
        text = request.get('text')
        if not isinstance(text, str) or not text.strip() or len(text) > 70:
            raise WorkerError('TEXT', '每段合成需要 1–70 个字符。')
        with torch.inference_mode():
            wave, rate = synthesize(text, request.get('voice', args.voice))
        wave = np.asarray(wave, dtype=np.float32).reshape(-1)
        if not len(wave) or not np.isfinite(wave).all() or not np.any(wave):
            raise WorkerError('AUDIO', '模型返回空音频或无效波形。')
        output = io.BytesIO()
        sf.write(output, wave, rate, format='WAV', subtype='PCM_16')
        return {'audioBase64': base64.b64encode(output.getvalue()).decode('ascii'), 'mime': 'audio/wav'}


if __name__ == '__main__':
    # Numerical DLL initialization on Windows can block if a background thread
    # holds stdin. Keep SDK imports and JSONL reads on one thread, like IndexTTS.
    # The Host terminates the owned process tree if unload interrupts a CUDA call.
    for line in sys.stdin:
        if len(line) > 65536:
            break
        request = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise WorkerError('REQUEST', '请求必须是 JSON 对象。')
            result = {'id': request.get('id'), 'ok': True, **handle(request)}
        except Exception as exc:
            if os.environ.get('DSH_TTS_DEBUG') == '1':
                import traceback
                traceback.print_exc(file=sys.stderr)
            result = {'id': request.get('id') if isinstance(request, dict) else None, 'ok': False,
                      'code': getattr(exc, 'code', 'MODEL_SDK'), 'error': '本地模型加载或合成失败：' + str(exc)[:400]}
        print(json.dumps(result, ensure_ascii=False), flush=True)
