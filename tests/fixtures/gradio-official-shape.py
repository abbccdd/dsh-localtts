"""A tiny Gradio 5 service with the parameter shapes of upstream WebUIs.

It contains no model or upstream code; it is only an offline protocol fixture.
"""
from __future__ import annotations
import argparse
import io
import time
import wave
from pathlib import Path
import gradio as gr

p = argparse.ArgumentParser(); p.add_argument('--engine', choices=['indextts', 'gpt-sovits']); p.add_argument('--variant', default='standard'); p.add_argument('--port', type=int); a = p.parse_args()

def audio(text):
    out = io.BytesIO()
    with wave.open(out, 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000); f.writeframes(b'\0\0' * max(80, len(text) * 20))
    return out.getvalue()

def gen_single(emo_control_method, prompt, text, lang_choice, emo_ref_path=None, emo_weight=0.65, vec1=0, vec2=0, vec3=0, vec4=0, vec5=0, vec6=0, vec7=0, vec8=0, emo_text='', emo_random=False, max_text_tokens_per_segment=120, duration_factor=1.0, do_sample=False, top_p=0.8, top_k=30, temperature=0.8, length_penalty=0.0, num_beams=3, repetition_penalty=10.0, max_mel_tokens=1500):
    return "fixture.wav"

def get_tts_wav(ref_wav_path, prompt_text, prompt_language, text, text_language, how_to_cut='不切', top_k=20, top_p=0.6, temperature=0.6, ref_free=False, speed=1, if_freeze=False, inp_refs=None, sample_steps=8, if_sr=False, pause_second=0.3, use_cuda_graph=False):
    return "fixture.wav"

def inference(text, text_lang, ref_audio_path, aux_ref_audio_paths, prompt_text, prompt_lang, top_k=15, top_p=1, temperature=1, text_split_method='cut5', batch_size=1, speed_factor=1, ref_text_free=False, split_bucket=True, fragment_interval=0.3, seed=-1, keep_random=True, parallel_infer=True, repetition_penalty=1.35, sample_steps=32, super_sampling=False):
    return ("fixture.wav", 1)

Path('fixture.wav').write_bytes(audio('fixture'))

with gr.Blocks() as app:
    if a.engine == 'indextts':
        button = gr.Button('Generate'); emo = gr.Radio(['Reference'], value='Reference'); prompt = gr.Audio(type='filepath'); text = gr.Textbox(); lang = gr.Radio(['ZH', 'EN'], value='ZH'); output = gr.Audio(type='filepath')
        button.click(gen_single, [emo, prompt, text, lang], [output], api_name='gen_single')
    elif a.variant == 'fast':
        button = gr.Button('Generate'); text = gr.Textbox(); text_lang = gr.Radio(['中文', '英文'], value='中文'); ref = gr.Audio(type='filepath'); prompt = gr.Textbox(); prompt_lang = gr.Radio(['中文', '英文'], value='中文'); output = gr.Audio(type='filepath')
        button.click(inference, [text, text_lang, ref, gr.State([]), prompt, prompt_lang], [output, gr.Number()], api_name='inference')
    else:
        button = gr.Button('Generate'); ref = gr.Audio(type='filepath'); prompt = gr.Textbox(); prompt_lang = gr.Radio(['中文', '英文'], value='中文'); text = gr.Textbox(); text_lang = gr.Radio(['中文', '英文'], value='中文'); output = gr.Audio(type='filepath')
        button.click(get_tts_wav, [ref, prompt, prompt_lang, text, text_lang], [output], api_name='get_tts_wav')

app.launch(server_name='127.0.0.1', server_port=a.port, inbrowser=False, share=False, quiet=True)
