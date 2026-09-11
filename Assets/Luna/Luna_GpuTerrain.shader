Shader "Luna/GpuTerrain"
{
    Properties
    {
        _HeightTex ("GPU Height Field", 2D) = "black" {}
        _LowColor ("Low Elevation", Color) = (0.08, 0.16, 0.10, 1)
        _HighColor ("High Elevation", Color) = (0.52, 0.40, 0.22, 1)
        _RockColor ("Steep Rock", Color) = (0.24, 0.27, 0.29, 1)
        _SnowColor ("High Ridge", Color) = (0.82, 0.84, 0.78, 1)
        _HeightAmplitude ("Height Amplitude", Float) = 96
        _BaseFrequency ("FBM Frequency", Float) = 0.0008
        _TerrainSeed ("Terrain Seed", Float) = 20260912
        _HeightWorldOrigin ("Height World Origin", Vector) = (0, 0, 0, 0)
        _HeightWorldSize ("Height World Size", Float) = 4096
        _CameraWorldXZ ("Camera World XZ", Vector) = (0, 0, 0, 0)
        _GridSpacing ("Grid Spacing", Float) = 1
        _RingInner ("Ring Inner", Float) = -0.5
        _RingOuter ("Ring Outer", Float) = 64
        _MorphWidth ("Morph Width", Float) = 8
        _Level ("LOD Level", Float) = 0
        _DebugMode ("Debug Mode", Float) = 0
        _HeightTextureInfluence ("Height Texture Influence", Range(0, 1)) = 1
    }

    SubShader
    {
        Tags
        {
            "RenderPipeline" = "UniversalPipeline"
            "RenderType" = "Opaque"
            "Queue" = "Geometry"
        }

        Pass
        {
            Name "LunaGpuTerrainForward"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D(_HeightTex);
            SAMPLER(sampler_HeightTex);

            CBUFFER_START(UnityPerMaterial)
                float4 _LowColor;
                float4 _HighColor;
                float4 _RockColor;
                float4 _SnowColor;
                float4 _HeightWorldOrigin;
                float4 _CameraWorldXZ;
                float _HeightAmplitude;
                float _BaseFrequency;
                float _TerrainSeed;
                float _HeightWorldSize;
                float _GridSpacing;
                float _RingInner;
                float _RingOuter;
                float _MorphWidth;
                float _Level;
                float _DebugMode;
                float _HeightTextureInfluence;
            CBUFFER_END

            struct Attributes
            {
                float3 positionOS : POSITION;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 worldPos : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
                float ringRadius : TEXCOORD3;
                float height01 : TEXCOORD4;
            };

            float Hash21(float2 p)
            {
                p = frac(p * float2(123.34, 345.45));
                p += dot(p, p + 34.345);
                return frac(p.x * p.y);
            }

            float ValueNoise(float2 p, float seed)
            {
                float seedOffset = frac(seed * 0.000001) * 100.0;
                p += seedOffset;
                float2 i = floor(p);
                float2 f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = Hash21(i);
                float b = Hash21(i + float2(1.0, 0.0));
                float c = Hash21(i + float2(0.0, 1.0));
                float d = Hash21(i + float2(1.0, 1.0));
                return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
            }

            float FBM(float2 worldXZ)
            {
                float sum = 0.0;
                float amplitude = 0.5;
                float frequency = _BaseFrequency;
                float normalizer = 0.0;

                [unroll]
                for (int octave = 0; octave < 6; octave++)
                {
                    sum += ValueNoise(worldXZ * frequency, _TerrainSeed + octave * 19.19) * amplitude;
                    normalizer += amplitude;
                    frequency *= 2.02;
                    amplitude *= 0.5;
                }

                return sum / normalizer;
            }

            float HeightFromTexture(float2 worldXZ)
            {
                float2 uv = (worldXZ - _HeightWorldOrigin.xy) / _HeightWorldSize;
                float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
                float generated = SAMPLE_TEXTURE2D_LOD(_HeightTex, sampler_HeightTex, saturate(uv), 0).r;
                float analytic = FBM(worldXZ);
                float normalized = lerp(analytic, generated, _HeightTextureInfluence * inside);
                return (normalized * 2.0 - 1.0) * _HeightAmplitude;
            }

            float HeightAt(float2 worldXZ)
            {
                return HeightFromTexture(worldXZ);
            }

            float HeightAtGridSpacing(float2 worldXZ, float spacing)
            {
                float2 aligned = floor(worldXZ / spacing + 0.5) * spacing;
                return HeightAt(aligned);
            }

            float MorphedHeight(float2 worldXZ)
            {
                float2 fromCamera = worldXZ - _CameraWorldXZ.xy;
                float radius = max(abs(fromCamera.x), abs(fromCamera.y));
                float fineHeight = HeightAt(worldXZ);
                float gridHeight = HeightAtGridSpacing(worldXZ, _GridSpacing);
                float coarseHeight = HeightAtGridSpacing(worldXZ, _GridSpacing * 2.0);
                float outerMorph = smoothstep(_RingOuter - _MorphWidth, _RingOuter, radius);
                float innerMorph = smoothstep(_RingInner, _RingInner + _MorphWidth, radius);
                float height = lerp(fineHeight, gridHeight, saturate(1.0 - innerMorph));
                return lerp(height, coarseHeight, outerMorph);
            }

            Varyings Vert(Attributes input)
            {
                Varyings output;
                float3 baseWorld = TransformObjectToWorld(input.positionOS);
                float2 worldXZ = baseWorld.xz;
                float2 fromCamera = worldXZ - _CameraWorldXZ.xy;
                float radius = max(abs(fromCamera.x), abs(fromCamera.y));
                float height = MorphedHeight(worldXZ);

                float sampleDistance = max(0.5, _GridSpacing * 0.5);
                float heightX = MorphedHeight(worldXZ + float2(sampleDistance, 0));
                float heightZ = MorphedHeight(worldXZ + float2(0, sampleDistance));
                float3 normal = normalize(float3(height - heightX, sampleDistance, height - heightZ));

                float3 displacedWorld = float3(worldXZ.x, height, worldXZ.y);
                output.positionCS = TransformWorldToHClip(displacedWorld);
                output.worldPos = displacedWorld;
                output.normalWS = normal;
                output.uv = input.uv;
                output.ringRadius = radius;
                output.height01 = saturate(height / (_HeightAmplitude * 2.0) + 0.5);
                return output;
            }

            half3 LODColor(float level)
            {
                half3 colors[6] = {
                    half3(0.10, 0.80, 0.95),
                    half3(0.20, 0.95, 0.35),
                    half3(0.95, 0.85, 0.15),
                    half3(1.00, 0.45, 0.10),
                    half3(0.95, 0.20, 0.30),
                    half3(0.65, 0.25, 0.95)
                };
                int index = clamp((int)round(level), 0, 5);
                return colors[index];
            }

            half4 Frag(Varyings input) : SV_Target
            {
                // A one-metre overlap prevents a rasterization gap while both edges use aligned heights.
                clip(input.ringRadius - (_RingInner - 1.0));
                clip((_RingOuter + 1.0) - input.ringRadius);

                if (_DebugMode > 1.5)
                {
                    float2 gridUV = input.uv * 128.0;
                    float2 cell = abs(frac(gridUV) - 0.5);
                    float lineWidth = max(fwidth(gridUV.x), fwidth(gridUV.y)) * 1.5;
                    float gridLine = 1.0 - smoothstep(0.5 - lineWidth, 0.5, max(cell.x, cell.y));
                    return half4(lerp(half3(0.015, 0.025, 0.035), half3(0.95, 0.98, 1.0), gridLine), 1.0);
                }

                if (_DebugMode > 0.5)
                {
                    return half4(LODColor(_Level), 1.0);
                }

                half3 normal = normalize(input.normalWS);
                Light mainLight = GetMainLight();
                half ndl = saturate(dot(normal, mainLight.direction));
                half slope = saturate(1.0 - normal.y);
                half3 terrainColor = lerp(_LowColor.rgb, _HighColor.rgb, input.height01);
                terrainColor = lerp(terrainColor, _RockColor.rgb, smoothstep(0.20, 0.72, slope));
                terrainColor = lerp(terrainColor, _SnowColor.rgb, smoothstep(0.78, 0.96, input.height01));
                half3 ambient = SampleSH(normal);
                half3 lit = terrainColor * (0.25 + ndl * 0.75) * mainLight.color + terrainColor * ambient * 0.45;
                return half4(lit, 1.0);
            }
            ENDHLSL
        }
    }
}
