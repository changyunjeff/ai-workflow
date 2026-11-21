"""Static checks for a Unity URP shader file (ShaderLab + HLSL), without Unity.

It catches what makes a shader fail to load or render in a URP project for reasons that can be seen
in the text: wrong pipeline tag, built-in-pipeline leftovers, missing entry points, includes that
point outside the URP packages, unbalanced braces, and SRP Batcher breakers. It cannot compile HLSL:
type errors, misspelled function names and wrong argument counts only show up in Unity.

check(text) returns (short, how-to-fix) pairs, the same shape as the machine gate's other checks.
"""
import re

URP_CORE = "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
INCLUDE_ROOTS = ("Packages/com.unity.render-pipelines.universal/", "Packages/com.unity.render-pipelines.core/")
URP_LIGHTMODES = {"UniversalForward", "UniversalForwardOnly", "UniversalGBuffer", "ShadowCaster", "DepthOnly",
                  "DepthNormals", "DepthNormalsOnly", "Meta", "Universal2D", "SRPDefaultUnlit", "MotionVectors",
                  "XRMotionVectors"}
# Things that exist only in the built-in render pipeline. In a URP HLSLPROGRAM they are undefined or ignored.
LEGACY = [
    (r"#\s*pragma\s+surface\b", "#pragma surface（表面着色器）", "URP 不支持表面着色器，要写成 vertex/fragment 两个函数"),
    (r"\bCGPROGRAM\b|\bENDCG\b|\bCGINCLUDE\b", "CGPROGRAM", "URP 里用 HLSLPROGRAM / ENDHLSL（以及 HLSLINCLUDE），不要用 CG 的写法"),
    (r"\.cginc\b", ".cginc 文件", "不要 include 内置管线的 .cginc 文件，改用 URP 的 ShaderLibrary（如 Core.hlsl、Lighting.hlsl）"),
    (r"\bUnityObjectToClipPos\b", "UnityObjectToClipPos", "改用 TransformObjectToHClip(positionOS.xyz)"),
    (r"\bUnityObjectToWorldNormal\b", "UnityObjectToWorldNormal", "改用 TransformObjectToWorldNormal(normalOS)"),
    (r"\b_LightColor0\b", "_LightColor0", "改用 GetMainLight().color（要 include Lighting.hlsl）"),
    (r"\b_WorldSpaceLightPos0\b", "_WorldSpaceLightPos0", "改用 GetMainLight().direction（要 include Lighting.hlsl）"),
    (r"\bUNITY_LIGHTMODEL_AMBIENT\b", "UNITY_LIGHTMODEL_AMBIENT", "环境光改用 SampleSH(normalWS)"),
    (r"\bfixed[234]?(x[234])?\b", "fixed 类型", "URP 的 HLSL 里没有 fixed 类型，改用 half 或 float"),
    (r"\bUNITY_FOG_COORDS\b|\bUNITY_TRANSFER_FOG\b|\bUNITY_APPLY_FOG\b", "内置管线的雾宏",
     "雾改用 ComputeFogFactor(positionCS.z) 和 MixFog(color, fogFactor)"),
]
TEXTURE_TYPES = {"2D", "3D", "Cube", "2DArray", "CubeArray"}
PROP_RE = re.compile(r"^\s*((?:\[[^\]]*\]\s*)*)(_?\w+)\s*\(\s*\"[^\"]*\"\s*,\s*([^)]*\)?)\s*\)\s*=\s*(.+?)\s*$")


def _strip_comments(text):
    """Blank out comments but keep string literals and line numbers."""
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == '"':
            j = text.find('"', i + 1)
            j = n - 1 if j < 0 else j
            out.append(text[i:j + 1])
            i = j + 1
        elif text.startswith("//", i):
            j = text.find("\n", i)
            j = n if j < 0 else j
            i = j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append("\n" * text.count("\n", i, j))
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out)


def _no_strings(text):
    """Same length as text, with the inside of string literals blanked, so indexes still line up."""
    return re.sub(r'"[^"\n]*"', lambda m: '"' + " " * (len(m.group(0)) - 2) + '"', text)


def _block_after(text, start):
    """Given the index of an opening brace, return (body, index after the closing brace) or (None, start)."""
    depth, i, plain = 0, start, _no_strings(text)  # same length as text, braces inside strings removed
    while i < len(plain):
        if plain[i] == "{":
            depth += 1
        elif plain[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1:i], i + 1
        i += 1
    return None, start


def _blocks(text, keyword):
    """All `keyword { ... }` blocks at any depth, outside HLSL programs."""
    found = []
    for m in re.finditer(rf"\b{keyword}\s*{{", text):
        body, _ = _block_after(text, m.end() - 1)
        if body is not None:
            found.append(body)
    return found


def _programs(text, begin, end):
    return re.findall(rf"\b{begin}\b(.*?)\b{end}\b", text, flags=re.S)


def _shaderlab_only(text):
    """Text with HLSL program bodies removed, so ShaderLab keywords inside code do not confuse the block finder."""
    return re.sub(r"\b(HLSLPROGRAM|HLSLINCLUDE|CGPROGRAM|CGINCLUDE)\b.*?\b(ENDHLSL|ENDCG)\b", " ", text, flags=re.S)


def _cbuffer(code):
    m = re.search(r"CBUFFER_START\s*\(\s*UnityPerMaterial\s*\)(.*?)CBUFFER_END", code, flags=re.S)
    return None if m is None else " ".join(m.group(1).split())


def check(raw):
    out = []
    text = raw.strip()
    if text.startswith("```") or text.rstrip().endswith("```"):
        out.append(("包在代码块标记里", "产出是直接存成 .shader 文件的，第一行必须是 Shader \"…\"，前后不能有 ``` 代码块标记"))
        text = re.sub(r"^```\w*\s*|\s*```$", "", text).strip()
    src = _strip_comments(text)
    if not re.match(r'Shader\s+"[^"]+"', src.lstrip()):
        out.append(("开头不是 Shader \"名字\"", "文件第一行必须是 Shader \"分组/名字\" {，前面不能有说明文字"))
    plain = _no_strings(src)
    if plain.count("{") != plain.count("}"):
        out.append((f"大括号不配对（{{ {plain.count('{')} 个，}} {plain.count('}')} 个）",
                    f"左大括号 {plain.count('{')} 个、右大括号 {plain.count('}')} 个，数量不一样，Unity 会解析失败。逐个块核对补齐"))
        return out  # the block finder below needs balanced braces

    for pattern, name, fix in LEGACY:
        if re.search(pattern, src):
            out.append((f"用了内置管线的 {name}", f"用了内置管线才有的 {name}：{fix}"))

    lab = _shaderlab_only(src)
    subshaders = _blocks(lab, "SubShader")
    if not subshaders:
        out.append(("没有 SubShader", "至少要有一个 SubShader { … }"))
    elif not re.search(r'"RenderPipeline"\s*=\s*"UniversalPipeline"', subshaders[0]):
        out.append(("SubShader 没标 URP", 'SubShader 的 Tags 里必须有 "RenderPipeline" = "UniversalPipeline"，否则 URP 不会用它'))

    # ---- properties ----
    props, bad_lines = {}, []
    blocks = _blocks(lab, "Properties")
    for line in (blocks[0].splitlines() if blocks else []):
        if not line.strip():
            continue
        m = PROP_RE.match(line)
        if not m:
            bad_lines.append(line.strip())
            continue
        attrs, name, kind = m.group(1), m.group(2), m.group(3).strip()
        props[name] = {"attrs": attrs, "kind": kind.split("(")[0].strip()}
    if bad_lines:
        out.append((f"有 {len(bad_lines)} 行属性写法不对", "Properties 里每行要写成 _Name (\"显示名\", 类型) = 默认值，"
                    "比如 _BaseColor (\"Base Color\", Color) = (1,1,1,1)。这几行不对：" + "；".join(bad_lines[:5])))

    # ---- passes ----
    shared = "\n".join(_programs(src, "HLSLINCLUDE", "ENDHLSL"))
    pass_bodies = []
    for m in re.finditer(r"\bPass\s*{", src):
        body, _ = _block_after(src, m.end() - 1)
        if body is not None:
            pass_bodies.append(body)
    if not pass_bodies:
        out.append(("没有 Pass", "SubShader 里至少要有一个 Pass { … HLSLPROGRAM … ENDHLSL }"))
    modes, cbuffers, all_code = [], {}, shared
    for k, body in enumerate(pass_bodies, 1):
        tag = re.search(r'"LightMode"\s*=\s*"(\w+)"', _shaderlab_only(body))
        mode = tag.group(1) if tag else "SRPDefaultUnlit"
        label = f"第 {k} 个 Pass（{mode}）"
        modes.append(mode)
        if mode not in URP_LIGHTMODES:
            out.append((f"{label}的 LightMode 不是 URP 的", f'{label}的 "LightMode" = "{mode}" 是内置管线的写法，URP 不会画它。'
                        '主体画面用 "UniversalForward"，投影用 "ShadowCaster"'))
        progs = _programs(body, "HLSLPROGRAM", "ENDHLSL")
        if not progs:
            out.append((f"{label}没有 HLSLPROGRAM", f"{label}里要有 HLSLPROGRAM … ENDHLSL"))
            continue
        code = shared + "\n" + progs[0]
        all_code += "\n" + progs[0]
        if URP_CORE not in code:
            out.append((f"{label}没 include Core.hlsl", f'{label}（或公共的 HLSLINCLUDE）里要有 #include "{URP_CORE}"'))
        for kind in ("vertex", "fragment"):
            p = re.search(rf"#\s*pragma\s+{kind}\s+(\w+)", code)
            if not p:
                out.append((f"{label}缺 #pragma {kind}", f"{label}要用 #pragma {kind} 函数名 指明{'顶点' if kind == 'vertex' else '片元'}函数"))
            elif not re.search(rf"\b\w+\s+{p.group(1)}\s*\(", code.replace(p.group(0), "")):
                out.append((f"{label}找不到函数 {p.group(1)}", f"#pragma {kind} 指向 {p.group(1)}，但代码里没有定义这个函数"))
        cbuffers[label] = _cbuffer(code)
    dup = sorted({m for m in modes if modes.count(m) > 1})
    if dup:
        out.append(("有重复的 LightMode", f"有两个以上的 Pass 用了同一个 LightMode（{'、'.join(dup)}），URP 只画其中一个。"
                    "需要两遍绘制时，一个用 \"UniversalForward\"、另一个不写 LightMode（即 SRPDefaultUnlit）"))
    if modes and not set(modes) & {"UniversalForward", "UniversalForwardOnly", "SRPDefaultUnlit", "Universal2D"}:
        out.append(("没有画颜色的 Pass", '至少要有一个 Pass 的 LightMode 是 "UniversalForward"，否则物体在画面里看不见'))

    # ---- includes ----
    for inc in sorted(set(re.findall(r'#\s*include\s+"([^"]+)"', src))):
        if not inc.startswith(INCLUDE_ROOTS):
            out.append((f"include 了包外的文件 {inc}", f"#include \"{inc}\" 指向 URP 包之外的文件。成品只有这一个文件，"
                        "只能 include Packages/com.unity.render-pipelines.universal/ 或 .core/ 下的文件，自己的函数直接写在文件里"))

    # ---- SRP Batcher: every material property lives in one UnityPerMaterial buffer, identical in every pass ----
    with_cb = {k: v for k, v in cbuffers.items() if v is not None}
    if props and cbuffers and not with_cb:
        out.append(("没有 UnityPerMaterial 常量缓冲", "材质参数要放进 CBUFFER_START(UnityPerMaterial) … CBUFFER_END，"
                    "否则不兼容 SRP Batcher。放在 HLSLINCLUDE 里，所有 Pass 共用一份"))
    elif len(set(with_cb.values())) > 1 or (with_cb and len(with_cb) < len(cbuffers)):
        out.append(("各 Pass 的 UnityPerMaterial 不一样", "每个 Pass 的 CBUFFER_START(UnityPerMaterial) 内容必须完全相同，"
                    "否则不兼容 SRP Batcher。把它挪到 HLSLINCLUDE 里共用一份"))
    cb_text = " ".join(v for v in with_cb.values() if v)
    pm = re.search(r"\bProperties\s*{", src)
    outside_props = src if pm is None else src[:pm.start()] + src[_block_after(src, pm.end() - 1)[1]:]
    # where a property is actually used: not its Properties line, CBUFFER entry or TEXTURE2D/SAMPLER declaration
    usage = re.sub(r"CBUFFER_START.*?CBUFFER_END", " ", outside_props, flags=re.S)
    usage = re.sub(r"\b(TEXTURE\w*|SAMPLER)\s*\(\s*\w+\s*\)|\bsampler\w*\s+\w+\s*;", " ", usage)
    missing_cb, unused, no_tex = [], [], []
    for name, p in props.items():
        if p["kind"] in TEXTURE_TYPES:
            if not re.search(rf"\b(TEXTURE2D|TEXTURE3D|TEXTURECUBE|TEXTURE2D_ARRAY|TEXTURECUBE_ARRAY)\s*\(\s*{name}\s*\)"
                             rf"|\bsampler\w*\s+{name}\b", all_code):
                no_tex.append(name)
            if re.search(rf"\b{name}_ST\b", all_code) and not re.search(rf"\b{name}_ST\b", cb_text):
                missing_cb.append(name + "_ST")
            continue
        used_in_code = re.search(rf"\b{name}\b", all_code)
        if used_in_code and with_cb and not re.search(rf"\b{name}\b", cb_text):
            missing_cb.append(name)
        if not re.search(rf"\b{name}\b", usage) and not re.search(r"Toggle|KeywordEnum|HideInInspector|Enum", p["attrs"]):
            unused.append(name)
    if missing_cb:
        out.append((f"{len(missing_cb)} 个参数不在 UnityPerMaterial 里", "这些材质参数在代码里用了，但没写进 CBUFFER_START(UnityPerMaterial)，"
                    "会破坏 SRP Batcher：" + "、".join(missing_cb)))
    if no_tex:
        out.append((f"{len(no_tex)} 张贴图没声明", "这些贴图属性在 HLSL 里没有用 TEXTURE2D(名字) 声明：" + "、".join(no_tex)
                    + "。每张贴图要有 TEXTURE2D(_Tex); SAMPLER(sampler_Tex);"))
    for name in props:
        if props[name]["kind"] in TEXTURE_TYPES and not re.search(rf"\b{name}\b", usage):
            unused.append(name)
    if unused:
        out.append((f"{len(unused)} 个参数没用上", "这些参数出现在材质面板上，但代码里没用到，调了也没反应：" + "、".join(dict.fromkeys(unused))
                    + "。要么在代码里用上，要么删掉"))
    for tex, smp in re.findall(r"SAMPLE_TEXTURE\w*\s*\(\s*(\w+)\s*,\s*(\w+)", all_code):
        if not re.search(rf"\bSAMPLER\s*\(\s*{smp}\s*\)", all_code):
            out.append((f"采样器 {smp} 没声明", f"采样 {tex} 用了 {smp}，但没有 SAMPLER({smp}); 的声明"))
            break
    if re.search(r"\btex2D\s*\(", all_code) and re.search(r"\bTEXTURE2D\s*\(", all_code):
        out.append(("tex2D 和 TEXTURE2D 混用", "用 TEXTURE2D 声明的贴图要用 SAMPLE_TEXTURE2D(贴图, 采样器, uv) 采样，不能用 tex2D"))
    return out


RULES = [
    '整个产出就是一个 .shader 文件的全文：第一行是 Shader "分组/名字" {，前后不要有说明文字，也不要 ``` 代码块标记',
    'SubShader 的 Tags 里有 "RenderPipeline" = "UniversalPipeline"',
    "只用 HLSLPROGRAM / ENDHLSL，不用 CGPROGRAM、表面着色器、.cginc、fixed 类型和其他内置管线的写法（UnityObjectToClipPos、_LightColor0 等）",
    f'每个 Pass 都 include "{URP_CORE}"（可放在公共的 HLSLINCLUDE 里），只 include URP 和 core 包里的文件',
    "每个 Pass 有 #pragma vertex 和 #pragma fragment，并且定义了对应的函数",
    'LightMode 只用 URP 的（主体画面 "UniversalForward"、投影 "ShadowCaster" 等），两个 Pass 不能用同一个',
    "所有非贴图的材质参数（以及用到的 _Tex_ST）都放在 CBUFFER_START(UnityPerMaterial) 里，所有 Pass 共用同一份（放在 HLSLINCLUDE 里最稳）",
    "贴图用 TEXTURE2D(_Tex); SAMPLER(sampler_Tex); 声明，用 SAMPLE_TEXTURE2D 采样",
    "Properties 里的每个参数都在代码里用上，没有摆设",
]
