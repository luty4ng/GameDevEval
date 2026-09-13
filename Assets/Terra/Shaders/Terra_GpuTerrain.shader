Shader "Terra/Terra_GpuTerrain"
{
    Properties
    {
        _TerraMaxHeight ("Maximum Height", Float) = 110
        _TerraDebugView ("Debug View", Float) = 0
    }

    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Opaque" "Queue" = "Geometry" }
        Pass
        {
            Name "TerraGpuTerrainForward"
            Tags { "LightMode" = "UniversalForward" }
            Cull Back
            ZWrite On
            ZTest LEqual

            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile_fragment _ _SHADOWS_SOFT

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            StructuredBuffer<float> _TerraHeightBuffer;

            CBUFFER_START(UnityPerMaterial)
                float _TerraMaxHeight;
                float _TerraDebugView;
                float _TerraLodIndex;
                float _TerraGridCells;
                float _TerraVerticesPerAxis;
                float4 _TerraLodOrigin;
            CBUFFER_END

            struct Attributes
            {
                uint vertexID : SV_VertexID;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float3 barycentric : TEXCOORD2;
                float lodIndex : TEXCOORD3;
                float2 lodCenter : TEXCOORD4;
            };

            uint TerraPointIndex(int2 gridCoordinate)
            {
                uint offset = (uint)(_TerraLodIndex * _TerraVerticesPerAxis * _TerraVerticesPerAxis);
                return offset + (uint)(gridCoordinate.y * _TerraVerticesPerAxis + gridCoordinate.x);
            }

            float TerraSampleHeight(float2 gridPoint)
            {
                float2 bounded = clamp(gridPoint, 0.0, _TerraVerticesPerAxis - 1.0);
                int2 a = (int2)floor(bounded);
                int2 b = min(a + 1, (int2)(_TerraVerticesPerAxis - 1.0));
                float2 t = frac(bounded);
                float h00 = _TerraHeightBuffer[TerraPointIndex(a)];
                float h10 = _TerraHeightBuffer[TerraPointIndex(int2(b.x, a.y))];
                float h01 = _TerraHeightBuffer[TerraPointIndex(int2(a.x, b.y))];
                float h11 = _TerraHeightBuffer[TerraPointIndex(b)];
                return lerp(lerp(h00, h10, t.x), lerp(h01, h11, t.x), t.y);
            }

            void TerraDecodeVertex(uint vertexID, out float2 gridPoint, out float3 barycentric)
            {
                uint quad = vertexID / 6u;
                uint corner = vertexID % 6u;
                uint x = quad % (uint)_TerraGridCells;
                uint z = quad / (uint)_TerraGridCells;

                if (corner == 0u || corner == 3u)
                {
                    gridPoint = float2(x, z);
                    barycentric = float3(1.0, 0.0, 0.0);
                }
                else if (corner == 1u)
                {
                    gridPoint = float2(x, z + 1u);
                    barycentric = float3(0.0, 1.0, 0.0);
                }
                else if (corner == 2u || corner == 4u)
                {
                    gridPoint = float2(x + 1u, z + 1u);
                    barycentric = float3(0.0, 0.0, 1.0);
                }
                else
                {
                    gridPoint = float2(x + 1u, z);
                    barycentric = float3(0.0, 1.0, 0.0);
                }
            }

            Varyings Vert(Attributes input)
            {
                Varyings output;
                float2 gridPoint;
                TerraDecodeVertex(input.vertexID, gridPoint, output.barycentric);

                float cellSize = _TerraLodOrigin.z;
                float2 centeredGrid = gridPoint - _TerraGridCells * 0.5;
                float2 worldXZ = _TerraLodOrigin.xy + centeredGrid * cellSize;
                float outerHalf = _TerraGridCells * cellSize * 0.5;
                float edgeRatio = max(abs(worldXZ.x - _TerraLodOrigin.x), abs(worldXZ.y - _TerraLodOrigin.y)) / outerHalf;

                // Morph only near an outer transition so a finer ring converges on the next coarser grid.
                float morph = smoothstep(0.74, 0.96, edgeRatio);
                float2 coarserWorldXZ = round(worldXZ / (cellSize * 2.0)) * (cellSize * 2.0);
                float2 morphedWorldXZ = lerp(worldXZ, coarserWorldXZ, morph);
                float2 morphedGridPoint = (morphedWorldXZ - _TerraLodOrigin.xy) / cellSize + _TerraGridCells * 0.5;
                float height = TerraSampleHeight(morphedGridPoint);

                float heightLeft = TerraSampleHeight(morphedGridPoint + float2(-1.0, 0.0));
                float heightRight = TerraSampleHeight(morphedGridPoint + float2(1.0, 0.0));
                float heightBack = TerraSampleHeight(morphedGridPoint + float2(0.0, -1.0));
                float heightForward = TerraSampleHeight(morphedGridPoint + float2(0.0, 1.0));
                float3 tangentX = float3(cellSize * 2.0, heightRight - heightLeft, 0.0);
                float3 tangentZ = float3(0.0, heightForward - heightBack, cellSize * 2.0);

                output.positionWS = float3(morphedWorldXZ.x, height, morphedWorldXZ.y);
                output.normalWS = normalize(cross(tangentZ, tangentX));
                output.positionCS = TransformWorldToHClip(output.positionWS);
                output.lodIndex = _TerraLodIndex;
                output.lodCenter = _TerraLodOrigin.xy;
                return output;
            }

            float3 TerraLodColor(float lod)
            {
                if (lod < 0.5) return float3(0.08, 0.82, 0.32);
                if (lod < 1.5) return float3(0.10, 0.58, 0.95);
                if (lod < 2.5) return float3(0.96, 0.58, 0.12);
                if (lod < 3.5) return float3(0.88, 0.18, 0.44);
                if (lod < 4.5) return float3(0.62, 0.30, 0.95);
                return float3(0.20, 0.90, 0.82);
            }

            half4 Frag(Varyings input) : SV_Target
            {
                // One parent-cell overlap absorbs independent snap offsets without introducing coplanar overdraw.
                if (input.lodIndex > 0.5)
                {
                    float cellSize = _TerraLodOrigin.z;
                    float innerHalf = (_TerraGridCells * 0.5 - 1.0) * (cellSize * 0.5);
                    float ringDistance = max(abs(input.positionWS.x - input.lodCenter.x), abs(input.positionWS.z - input.lodCenter.y));
                    clip(ringDistance - innerHalf);
                }

                float debugView = round(_TerraDebugView);
                if (debugView == 1.0)
                    return half4(TerraLodColor(input.lodIndex), 1.0);

                if (debugView == 2.0)
                {
                    float3 width = fwidth(input.barycentric);
                    float3 smoothBary = smoothstep(0.0, width * 1.35, input.barycentric);
                    float edge = min(smoothBary.x, min(smoothBary.y, smoothBary.z));
                    return half4(lerp(float3(0.015, 0.025, 0.035), TerraLodColor(input.lodIndex), edge), 1.0);
                }

                float height01 = saturate(input.positionWS.y / (_TerraMaxHeight * 2.0) + 0.42);
                float slope = saturate(1.0 - input.normalWS.y);
                float3 grass = lerp(float3(0.04, 0.16, 0.055), float3(0.21, 0.47, 0.12), height01);
                float3 rock = lerp(float3(0.18, 0.15, 0.11), float3(0.42, 0.38, 0.30), height01);
                float3 snow = float3(0.82, 0.88, 0.89);
                float3 albedo = lerp(grass, rock, smoothstep(0.22, 0.62, slope));
                albedo = lerp(albedo, snow, smoothstep(0.73, 0.94, height01) * (1.0 - slope * 0.45));

                Light mainLight = GetMainLight();
                float diffuse = saturate(dot(normalize(input.normalWS), mainLight.direction));
                float3 ambient = SampleSH(normalize(input.normalWS));
                float3 lit = albedo * (ambient + mainLight.color * (0.22 + diffuse * mainLight.shadowAttenuation));
                return half4(lit, 1.0);
            }
            ENDHLSL
        }
    }
}
