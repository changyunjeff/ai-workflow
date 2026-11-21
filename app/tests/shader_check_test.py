"""Tests for the URP shader machine check (app/shader_check.py). No Unity, no model quota.

Usage: python app/tests/shader_check_test.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import shader_check  # noqa: E402

HERE = Path(__file__).resolve().parent / "shaders"
GOOD = (HERE / "good-lit.shader").read_text(encoding="utf-8")
FAILS = []


def expect(name, text, short=None):
    """short=None: must pass. Otherwise one problem must start with `short`."""
    got = [p[0] for p in shader_check.check(text)]
    ok = not got if short is None else any(g.startswith(short) for g in got)
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  {got}"))
    if not ok:
        FAILS.append(name)


expect("a correct URP shader passes", GOOD)
expect("wrapped in a code fence", "```hlsl\n" + GOOD + "\n```", "包在代码块标记里")
expect("explanation before the shader", "下面是着色器：\n" + GOOD, "开头不是")
expect("missing closing brace", GOOD.rstrip()[:-1], "大括号不配对")
expect("no URP pipeline tag", GOOD.replace(' "RenderPipeline" = "UniversalPipeline"', ""), "SubShader 没标 URP")
expect("property missing from UnityPerMaterial", GOOD.replace("half _RustAmount;", ""), "1 个参数不在 UnityPerMaterial")
expect("property never used", GOOD.replace("* (0.5 + 0.5 * _Smoothness)", ""), "1 个参数没用上")
expect("two passes with one LightMode", GOOD.replace('"LightMode" = "ShadowCaster"', '"LightMode" = "UniversalForward"'),
       "有重复的 LightMode")
expect("pragma points at a missing function",
       GOOD.replace("#pragma fragment frag\n            #pragma shader", "#pragma fragment fragMain\n            #pragma shader"),
       "第 1 个 Pass（UniversalForward）找不到函数")
expect("sampler not declared", GOOD.replace("SAMPLER(sampler_BaseMap);", ""), "采样器 sampler_BaseMap 没声明")
expect("Core.hlsl not included", GOOD.replace('#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"', ""),
       "第 1 个 Pass（UniversalForward）没 include Core.hlsl")
expect("include of a file outside the URP packages", GOOD.replace("Lighting.hlsl\"", "Lighting.hlsl\"\n#include \"MyNoise.hlsl\""),
       "include 了包外的文件")
expect("UnityPerMaterial differs between passes",
       GOOD.replace("        CBUFFER_START(UnityPerMaterial)", "        CBUFFER_START(Unused)")
           .replace("#pragma shader_feature_local _EDGE_WEAR", "#pragma shader_feature_local _EDGE_WEAR\n"
                    "CBUFFER_START(UnityPerMaterial) half4 _BaseColor; CBUFFER_END"),
       "各 Pass 的 UnityPerMaterial 不一样")
expect("a comment containing a brace does not break parsing", GOOD.replace("Name \"ForwardLit\"", "Name \"ForwardLit\" // { note"))

bad = (HERE / "bad-builtin.shader").read_text(encoding="utf-8")
for short in ("用了内置管线的 CGPROGRAM", "用了内置管线的 .cginc", "用了内置管线的 UnityObjectToClipPos",
              "用了内置管线的 _LightColor0", "用了内置管线的 fixed", "SubShader 没标 URP", "第 1 个 Pass（ForwardBase）的 LightMode 不是 URP 的"):
    expect(f"built-in pipeline shader is rejected: {short}", bad, short)

print(f"\n{'全部通过' if not FAILS else f'{len(FAILS)} 项没过'}")
sys.exit(1 if FAILS else 0)
