Shader "Sol/GPU Driven Terrain"
{
    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "Queue" = "Geometry"
            "RenderPipeline" = "UniversalPipeline"
        }

        Pass
        {
            Name "SolGpuTerrainForward"
            Tags { "LightMode" = "UniversalForward" }
            Cull Off
            ZWrite On
            ZTest LEqual

            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex Sol_Vertex
            #pragma fragment Sol_Fragment
            #pragma multi_compile_fog
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            StructuredBuffer<float> _Sol_HeightBuffer;

            int _Sol_Resolution;
            int _Sol_BaseOffset;
            int _Sol_Level;
            float2 _Sol_PatchOffset;
            float2 _Sol_PatchCells;
            float2 _Sol_LevelOrigin;
            float2 _Sol_ParentOrigin;
            float _Sol_CellSize;
            float _Sol_ParentCellSize;
            float _Sol_HasParent;
            float _Sol_SkirtDepth;
            float2 _Sol_ViewCenter;
            float _Sol_MorphStartFraction;
            float _Sol_HeightAmplitude;
            int _Sol_DebugMode;

            struct SolVaryings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                float3 barycentric : TEXCOORD2;
                half fogFactor : TEXCOORD3;
            };

            static const uint2 Sol_Corners[6] =
            {
                uint2(0, 0), uint2(0, 1), uint2(1, 1),
                uint2(0, 0), uint2(1, 1), uint2(1, 0)
            };

            static const float3 Sol_Barycentrics[6] =
            {
                float3(1, 0, 0), float3(0, 1, 0), float3(0, 0, 1),
                float3(1, 0, 0), float3(0, 0, 1), float3(0, 1, 0)
            };

            int Sol_HeightIndex(int2 sampleCoordinate)
            {
                sampleCoordinate = clamp(sampleCoordinate, int2(0, 0), int2(_Sol_Resolution - 1, _Sol_Resolution - 1));
                return _Sol_BaseOffset + sampleCoordinate.y * _Sol_Resolution + sampleCoordinate.x;
            }

            float Sol_LoadHeight(int2 sampleCoordinate)
            {
                return _Sol_HeightBuffer[Sol_HeightIndex(sampleCoordinate)];
            }

            float2 Sol_MorphPosition(float2 worldXZ, out float morph)
            {
                float halfSpan = _Sol_CellSize * 32.0;
                float chebyshevDistance = max(abs(worldXZ.x - _Sol_ViewCenter.x), abs(worldXZ.y - _Sol_ViewCenter.y));
                float morphStart = halfSpan * _Sol_MorphStartFraction;
                morph = _Sol_HasParent * saturate((chebyshevDistance - morphStart) / max(halfSpan - morphStart, 0.001));
                float2 parentCoordinate = round((worldXZ - _Sol_ParentOrigin) / _Sol_ParentCellSize);
                float2 parentAligned = _Sol_ParentOrigin + parentCoordinate * _Sol_ParentCellSize;
                return lerp(worldXZ, parentAligned, morph);
            }

            void Sol_GetSurfaceVertex(uint vertexId, out float3 positionWS, out half3 normalWS, out float3 barycentric)
            {
                uint patchWidth = (uint)_Sol_PatchCells.x;
                uint cellId = vertexId / 6u;
                uint triangleVertex = vertexId % 6u;
                uint2 cell = uint2(cellId % patchWidth, cellId / patchWidth);
                uint2 sampleCoordinate = (uint2)_Sol_PatchOffset + cell + Sol_Corners[triangleVertex];

                float2 sourceXZ = _Sol_LevelOrigin + (float2)sampleCoordinate * _Sol_CellSize;
                float morph;
                float2 worldXZ = Sol_MorphPosition(sourceXZ, morph);
                int2 morphedSample = (int2)round((worldXZ - _Sol_LevelOrigin) / _Sol_CellSize);
                float height = Sol_LoadHeight(morphedSample);

                float heightLeft = Sol_LoadHeight(morphedSample + int2(-1, 0));
                float heightRight = Sol_LoadHeight(morphedSample + int2(1, 0));
                float heightDown = Sol_LoadHeight(morphedSample + int2(0, -1));
                float heightUp = Sol_LoadHeight(morphedSample + int2(0, 1));
                normalWS = normalize(half3(heightLeft - heightRight, 2.0 * _Sol_CellSize, heightDown - heightUp));
                positionWS = float3(worldXZ.x, height, worldXZ.y);
                barycentric = Sol_Barycentrics[triangleVertex];
            }

            void Sol_GetSkirtVertex(uint skirtVertexId, out float3 positionWS, out half3 normalWS, out float3 barycentric)
            {
                uint patchWidth = (uint)_Sol_PatchCells.x;
                uint patchHeight = (uint)_Sol_PatchCells.y;
                uint segment = skirtVertexId / 6u;
                uint triangleVertex = skirtVertexId % 6u;
                uint2 startCoordinate;
                uint2 endCoordinate;
                float2 outward;

                if (segment < patchWidth)
                {
                    startCoordinate = uint2(segment, 0);
                    endCoordinate = startCoordinate + uint2(1, 0);
                    outward = float2(0, -1);
                }
                else if (segment < patchWidth + patchHeight)
                {
                    uint edgeSegment = segment - patchWidth;
                    startCoordinate = uint2(patchWidth, edgeSegment);
                    endCoordinate = startCoordinate + uint2(0, 1);
                    outward = float2(1, 0);
                }
                else if (segment < patchWidth * 2u + patchHeight)
                {
                    uint edgeSegment = segment - patchWidth - patchHeight;
                    startCoordinate = uint2(patchWidth - edgeSegment, patchHeight);
                    endCoordinate = startCoordinate - uint2(1, 0);
                    outward = float2(0, 1);
                }
                else
                {
                    uint edgeSegment = segment - patchWidth * 2u - patchHeight;
                    startCoordinate = uint2(0, patchHeight - edgeSegment);
                    endCoordinate = startCoordinate - uint2(0, 1);
                    outward = float2(-1, 0);
                }

                uint2 patchOffset = (uint2)_Sol_PatchOffset;
                float2 startXZ = _Sol_LevelOrigin + (float2)(patchOffset + startCoordinate) * _Sol_CellSize;
                float2 endXZ = _Sol_LevelOrigin + (float2)(patchOffset + endCoordinate) * _Sol_CellSize;
                float startMorph;
                float endMorph;
                startXZ = Sol_MorphPosition(startXZ, startMorph);
                endXZ = Sol_MorphPosition(endXZ, endMorph);
                int2 startSample = (int2)round((startXZ - _Sol_LevelOrigin) / _Sol_CellSize);
                int2 endSample = (int2)round((endXZ - _Sol_LevelOrigin) / _Sol_CellSize);
                float startHeight = Sol_LoadHeight(startSample);
                float endHeight = Sol_LoadHeight(endSample);

                float3 topStart = float3(startXZ.x, startHeight, startXZ.y);
                float3 topEnd = float3(endXZ.x, endHeight, endXZ.y);
                float3 bottomStart = topStart + float3(outward.x * _Sol_CellSize, -_Sol_SkirtDepth, outward.y * _Sol_CellSize);
                float3 bottomEnd = topEnd + float3(outward.x * _Sol_CellSize, -_Sol_SkirtDepth, outward.y * _Sol_CellSize);

                if (triangleVertex == 0u) positionWS = topStart;
                else if (triangleVertex == 1u) positionWS = topEnd;
                else if (triangleVertex == 2u) positionWS = bottomEnd;
                else if (triangleVertex == 3u) positionWS = topStart;
                else if (triangleVertex == 4u) positionWS = bottomEnd;
                else positionWS = bottomStart;

                normalWS = normalize(cross(topEnd - topStart, bottomStart - topStart));
                barycentric = Sol_Barycentrics[triangleVertex];
            }

            SolVaryings Sol_Vertex(uint vertexId : SV_VertexID)
            {
                SolVaryings output;
                uint topVertexCount = (uint)(_Sol_PatchCells.x * _Sol_PatchCells.y) * 6u;
                if (vertexId < topVertexCount)
                {
                    Sol_GetSurfaceVertex(vertexId, output.positionWS, output.normalWS, output.barycentric);
                }
                else
                {
                    Sol_GetSkirtVertex(vertexId - topVertexCount, output.positionWS, output.normalWS, output.barycentric);
                }

                output.positionCS = TransformWorldToHClip(output.positionWS);
                output.fogFactor = ComputeFogFactor(output.positionCS.z);
                return output;
            }

            half3 Sol_LodColor(int level)
            {
                if (level == 0) return half3(0.10, 0.95, 0.28);
                if (level == 1) return half3(0.05, 0.55, 1.00);
                if (level == 2) return half3(0.78, 0.20, 1.00);
                if (level == 3) return half3(1.00, 0.68, 0.08);
                if (level == 4) return half3(1.00, 0.18, 0.15);
                if (level == 5) return half3(0.10, 0.95, 0.90);
                return half3(0.95, 0.95, 0.95);
            }

            half4 Sol_Fragment(SolVaryings input) : SV_Target
            {
                half3 normalWS = normalize(input.normalWS);
                float normalizedHeight = saturate(input.positionWS.y / max(_Sol_HeightAmplitude, 0.001) * 0.5 + 0.5);
                float slope = saturate(1.0 - normalWS.y);

                half3 valleyColor = half3(0.07, 0.19, 0.08);
                half3 grassColor = half3(0.24, 0.42, 0.12);
                half3 rockColor = half3(0.34, 0.31, 0.27);
                half3 snowColor = half3(0.82, 0.86, 0.88);
                half3 albedo = lerp(valleyColor, grassColor, saturate(normalizedHeight * 2.0));
                albedo = lerp(albedo, rockColor, saturate(slope * 2.4));
                albedo = lerp(albedo, snowColor, smoothstep(0.72, 0.94, normalizedHeight) * (1.0 - slope * 0.35));

                if (_Sol_DebugMode == 1)
                {
                    albedo = Sol_LodColor(_Sol_Level);
                }

                Light mainLight = GetMainLight();
                half diffuse = saturate(dot(normalWS, mainLight.direction));
                half3 litColor = albedo * (0.24 + mainLight.color * diffuse * 0.88);

                if (_Sol_DebugMode == 2)
                {
                    float nearestEdge = min(input.barycentric.x, min(input.barycentric.y, input.barycentric.z));
                    float edgeWidth = max(fwidth(nearestEdge) * 1.2, 0.0005);
                    float interior = smoothstep(0.0, edgeWidth, nearestEdge);
                    litColor = lerp(half3(0.015, 0.02, 0.025), albedo * 0.42, interior);
                }

                litColor = MixFog(litColor, input.fogFactor);
                return half4(litColor, 1.0);
            }
            ENDHLSL
        }
    }

    FallBack Off
}
