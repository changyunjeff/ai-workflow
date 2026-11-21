Shader "AIWorkflow/RustyMetal"
{
    Properties
    {
        _BaseColor ("Base Color", Color) = (0.55, 0.56, 0.58, 1)
        _BaseMap ("Base Map", 2D) = "white" {}
        _RustColor ("Rust Color", Color) = (0.45, 0.2, 0.08, 1)
        _RustAmount ("Rust Amount", Range(0, 1)) = 0.35
        _Smoothness ("Smoothness", Range(0, 1)) = 0.7
        [Toggle(_EDGE_WEAR)] _EdgeWear ("Edge Wear", Float) = 1
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "Queue" = "Geometry" }

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        CBUFFER_START(UnityPerMaterial)
            float4 _BaseMap_ST;
            half4 _BaseColor;
            half4 _RustColor;
            half _RustAmount;
            half _Smoothness;
        CBUFFER_END
        TEXTURE2D(_BaseMap); SAMPLER(sampler_BaseMap);
        ENDHLSL

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma shader_feature_local _EDGE_WEAR
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; float3 normalWS : TEXCOORD1; };

            Varyings vert (Attributes v)
            {
                Varyings o;
                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                o.uv = TRANSFORM_TEX(v.uv, _BaseMap);
                return o;
            }

            half4 frag (Varyings i) : SV_Target
            {
                half4 albedo = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv) * _BaseColor;
                albedo.rgb = lerp(albedo.rgb, _RustColor.rgb, _RustAmount);
                Light light = GetMainLight();
                half ndl = saturate(dot(normalize(i.normalWS), light.direction));
                half3 color = albedo.rgb * (light.color * ndl + SampleSH(i.normalWS)) * (0.5 + 0.5 * _Smoothness);
                return half4(color, 1);
            }
            ENDHLSL
        }

        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }
            ColorMask 0
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            float4 vert (float4 positionOS : POSITION) : SV_POSITION { return TransformObjectToHClip(positionOS.xyz); }
            half4 frag () : SV_Target { return 0; }
            ENDHLSL
        }
    }
}
