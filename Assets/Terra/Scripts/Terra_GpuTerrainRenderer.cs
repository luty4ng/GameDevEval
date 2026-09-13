using UnityEngine;
using UnityEngine.Rendering;

namespace Terra.GpuTerrain
{
    /// <summary>Draws a six-level procedural clipmap without creating a Unity Mesh.</summary>
    [DefaultExecutionOrder(-100)]
    public sealed class TerraGpuTerrainRenderer : MonoBehaviour
    {
        public const int LodCount = 6;
        public const int GridCells = 128;
        private const int VerticesPerAxis = GridCells + 1;
        private const int PointsPerLod = VerticesPerAxis * VerticesPerAxis;
        private const int VerticesPerDraw = GridCells * GridCells * 6;

        [Header("Height Field")]
        [SerializeField] private int seed = 20260912;
        [SerializeField, Min(80f)] private float maximumHeight = 110f;
        [SerializeField, Min(0.0001f)] private float baseFrequency = 0.0035f;
        [SerializeField, Min(1.01f)] private float lacunarity = 2.02f;
        [SerializeField, Range(0.1f, 0.95f)] private float gain = 0.5f;

        private readonly Vector4[] lodOrigins = new Vector4[LodCount];
        private readonly Bounds[] drawBounds = new Bounds[LodCount];
        private ComputeShader heightCompute;
        private Material terrainMaterial;
        private MaterialPropertyBlock propertyBlock;
        private ComputeBuffer heightBuffer;
        private Camera driverCamera;
        private int heightKernel;
        [SerializeField, Range(0, 2)] private int debugView;
        private bool isReady;

        public int DebugView => debugView;
        public float EyeHeightSample(Vector3 worldPosition) => SampleHeight(worldPosition.x, worldPosition.z);

        public void SetDriverCamera(Camera camera)
        {
            driverCamera = camera;
        }

        private void Awake()
        {
            heightCompute = Resources.Load<ComputeShader>("Terra_GpuTerrainHeight");
            terrainMaterial = Resources.Load<Material>("Terra_GpuTerrain");
            driverCamera = Camera.main;

            if (heightCompute == null || terrainMaterial == null)
            {
                Debug.LogError("Terra GPU terrain needs Terra_GpuTerrainHeight.compute and Terra_GpuTerrain.mat in Assets/Terra/Resources/.", this);
                enabled = false;
                return;
            }

            heightKernel = heightCompute.FindKernel("GenerateHeights");
            heightBuffer = new ComputeBuffer(PointsPerLod * LodCount, sizeof(float), ComputeBufferType.Structured);
            propertyBlock = new MaterialPropertyBlock();
            heightCompute.SetBuffer(heightKernel, "_TerraHeightBuffer", heightBuffer);
            heightCompute.SetInt("_TerraPointsPerLod", PointsPerLod);
            heightCompute.SetInt("_TerraVerticesPerAxis", VerticesPerAxis);
            heightCompute.SetInt("_TerraLodCount", LodCount);
            isReady = true;
        }

        private void Update()
        {
            if (!isReady)
                return;

            if (UnityEngine.InputSystem.Keyboard.current != null && UnityEngine.InputSystem.Keyboard.current.f1Key.wasPressedThisFrame)
                debugView = (debugView + 1) % 3;
        }

        private void LateUpdate()
        {
            if (!isReady)
                return;

            if (driverCamera == null)
                driverCamera = Camera.main;
            if (driverCamera == null)
                return;

            UpdateGpuHeightField(driverCamera.transform.position);
            DrawClipmap();
        }

        private void UpdateGpuHeightField(Vector3 cameraPosition)
        {
            for (int lod = 0; lod < LodCount; lod++)
            {
                float cellSize = 1 << lod;
                float snappedX = Mathf.Floor(cameraPosition.x / cellSize) * cellSize;
                float snappedZ = Mathf.Floor(cameraPosition.z / cellSize) * cellSize;
                float coverage = GridCells * cellSize;
                lodOrigins[lod] = new Vector4(snappedX, snappedZ, cellSize, lod);
                // Bounds are only for culling; their generous vertical range avoids discarding mountain peaks.
                drawBounds[lod] = new Bounds(new Vector3(snappedX, 0f, snappedZ), new Vector3(coverage, maximumHeight * 3f, coverage));
            }

            heightCompute.SetInt("_TerraSeed", seed);
            heightCompute.SetFloat("_TerraMaxHeight", maximumHeight);
            heightCompute.SetFloat("_TerraBaseFrequency", baseFrequency);
            heightCompute.SetFloat("_TerraLacunarity", lacunarity);
            heightCompute.SetFloat("_TerraGain", gain);
            heightCompute.SetVectorArray("_TerraLodOrigins", lodOrigins);
            heightCompute.Dispatch(heightKernel, (PointsPerLod * LodCount + 63) / 64, 1, 1);
        }

        private void DrawClipmap()
        {
            // Submit coarse first so a finer ring owns the one-cell overlap used to hide snap transitions.
            for (int lod = LodCount - 1; lod >= 0; lod--)
            {
                propertyBlock.Clear();
                propertyBlock.SetBuffer("_TerraHeightBuffer", heightBuffer);
                propertyBlock.SetVector("_TerraLodOrigin", lodOrigins[lod]);
                propertyBlock.SetFloat("_TerraLodIndex", lod);
                propertyBlock.SetFloat("_TerraGridCells", GridCells);
                propertyBlock.SetFloat("_TerraVerticesPerAxis", VerticesPerAxis);
                propertyBlock.SetFloat("_TerraMaxHeight", maximumHeight);
                propertyBlock.SetFloat("_TerraDebugView", debugView);
                Graphics.DrawProcedural(terrainMaterial, drawBounds[lod], MeshTopology.Triangles, VerticesPerDraw, 1, null, propertyBlock, ShadowCastingMode.Off, true, gameObject.layer);
            }
        }

        // This intentionally mirrors the compute shader so the validation camera can remain within 0.5m of GPU terrain.
        private float SampleHeight(float worldX, float worldZ)
        {
            float broad = Fbm(worldX, worldZ);
            float ridges = 1f - Mathf.Abs(Fbm(worldX * 0.42f + 73f, worldZ * 0.42f - 41f));
            return (broad * 0.68f + (ridges - 0.5f) * 0.64f) * maximumHeight;
        }

        private float Fbm(float worldX, float worldZ)
        {
            float value = 0f;
            float amplitude = 1f;
            float normalizer = 0f;
            float frequency = baseFrequency;
            for (int octave = 0; octave < 5; octave++)
            {
                value += (ValueNoise(worldX * frequency, worldZ * frequency) * 2f - 1f) * amplitude;
                normalizer += amplitude;
                amplitude *= gain;
                frequency *= lacunarity;
            }

            return value / normalizer;
        }

        private float ValueNoise(float x, float z)
        {
            float ix = Mathf.Floor(x);
            float iz = Mathf.Floor(z);
            float fx = x - ix;
            float fz = z - iz;
            fx = fx * fx * (3f - 2f * fx);
            fz = fz * fz * (3f - 2f * fz);
            float a = Hash(ix, iz);
            float b = Hash(ix + 1f, iz);
            float c = Hash(ix, iz + 1f);
            float d = Hash(ix + 1f, iz + 1f);
            return Mathf.Lerp(Mathf.Lerp(a, b, fx), Mathf.Lerp(c, d, fx), fz);
        }

        private float Hash(float x, float z)
        {
            float hashed = Mathf.Sin(x * 127.1f + z * 311.7f + seed * 0.013f) * 43758.5453123f;
            return Mathf.Repeat(hashed, 1f);
        }

        private void OnDisable()
        {
            if (heightBuffer != null)
            {
                heightBuffer.Release();
                heightBuffer = null;
            }
        }
    }
}
