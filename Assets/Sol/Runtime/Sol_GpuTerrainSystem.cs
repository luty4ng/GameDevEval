using UnityEngine;
using UnityEngine.Rendering;

namespace Sol.GpuTerrain
{
    [DisallowMultipleComponent]
    public sealed class Sol_GpuTerrainSystem : MonoBehaviour
    {
        public const int LodCount = 7;
        public const int GridCells = 64;
        public const int SampleResolution = GridCells + 1;
        public const float FinestCellSize = 1.0f;
        public const float CoarsestCoverageMeters = GridCells * FinestCellSize * (1 << (LodCount - 1));

        private const int DrawCount = 1 + (LodCount - 1) * 4;
        private const int SamplesPerLevel = SampleResolution * SampleResolution;
        private const string ComputeResourceName = "Sol_TerrainHeight";
        private const string ShaderResourceName = "Sol_GpuTerrain";

        private static readonly int HeightBufferId = Shader.PropertyToID("_Sol_HeightBuffer");
        private static readonly int ResolutionId = Shader.PropertyToID("_Sol_Resolution");
        private static readonly int BaseOffsetId = Shader.PropertyToID("_Sol_BaseOffset");
        private static readonly int LevelId = Shader.PropertyToID("_Sol_Level");
        private static readonly int PatchOffsetId = Shader.PropertyToID("_Sol_PatchOffset");
        private static readonly int PatchCellsId = Shader.PropertyToID("_Sol_PatchCells");
        private static readonly int LevelOriginId = Shader.PropertyToID("_Sol_LevelOrigin");
        private static readonly int ParentOriginId = Shader.PropertyToID("_Sol_ParentOrigin");
        private static readonly int CellSizeId = Shader.PropertyToID("_Sol_CellSize");
        private static readonly int ParentCellSizeId = Shader.PropertyToID("_Sol_ParentCellSize");
        private static readonly int HasParentId = Shader.PropertyToID("_Sol_HasParent");
        private static readonly int SkirtDepthId = Shader.PropertyToID("_Sol_SkirtDepth");
        private static readonly int ViewCenterId = Shader.PropertyToID("_Sol_ViewCenter");
        private static readonly int DebugModeId = Shader.PropertyToID("_Sol_DebugMode");
        private static readonly int HeightAmplitudeId = Shader.PropertyToID("_Sol_HeightAmplitude");
        private static readonly int MorphStartFractionId = Shader.PropertyToID("_Sol_MorphStartFraction");

        [Header("Height field")]
        [SerializeField] private int seed = Sol_TerrainHeight.DefaultSeed;
        [SerializeField, Min(0.00001f)] private float frequency = Sol_TerrainHeight.DefaultFrequency;
        [SerializeField, Min(80.0f)] private float heightAmplitude = Sol_TerrainHeight.DefaultAmplitude;

        [Header("Clipmap")]
        [SerializeField, Range(0.5f, 0.9f)] private float morphStartFraction = 0.72f;
        [SerializeField, Min(2.0f)] private float minimumSkirtDepth = 12.0f;

        [SerializeField] private Camera targetCamera;

        private readonly Vector2[] _lodOrigins = new Vector2[LodCount];
        private readonly bool[] _lodDirty = new bool[LodCount];
        private readonly int[] _drawLevels = new int[DrawCount];
        private readonly int[] _vertexCounts = new int[DrawCount];
        private readonly MaterialPropertyBlock[] _propertyBlocks = new MaterialPropertyBlock[DrawCount];
        private readonly RenderParams[] _renderParams = new RenderParams[DrawCount];

        private ComputeShader _heightCompute;
        private ComputeBuffer _heightBuffer;
        private Material _material;
        private int _heightKernel;
        private int _debugMode;
        private int _lastSeed;
        private float _lastFrequency;
        private float _lastAmplitude;
        private bool _initialized;
        private long _lastManagedAllocationBytes;

        public bool IsReady => _initialized && _heightBuffer != null && _heightBuffer.IsValid();
        public int CurrentDebugMode => _debugMode;
        public int HeightBufferSampleCount => LodCount * SamplesPerLevel;
        public long LastManagedAllocationBytes => _lastManagedAllocationBytes;
        public Camera TargetCamera => targetCamera;

        public void SetTargetCamera(Camera camera)
        {
            targetCamera = camera;
        }

        public float SampleHeightCpu(float worldX, float worldZ)
        {
            return Sol_TerrainHeight.Sample(worldX, worldZ, seed, frequency, heightAmplitude);
        }

        public void CycleDebugMode()
        {
            _debugMode = (_debugMode + 1) % 3;
            Shader.SetGlobalInt(DebugModeId, _debugMode);
            Debug.Log($"[Sol GPU Terrain] Debug view: {GetDebugModeName(_debugMode)}", this);
        }

        private void OnEnable()
        {
            if (targetCamera == null)
            {
                targetCamera = Camera.main;
            }

            InitializeResources();
        }

        private void OnDisable()
        {
            ReleaseResources();
        }

        private void OnValidate()
        {
            frequency = Mathf.Max(0.00001f, frequency);
            heightAmplitude = Mathf.Max(80.0f, heightAmplitude);
            morphStartFraction = Mathf.Clamp(morphStartFraction, 0.5f, 0.9f);
            minimumSkirtDepth = Mathf.Max(2.0f, minimumSkirtDepth);
        }

        private void LateUpdate()
        {
            long allocationStart = System.GC.GetAllocatedBytesForCurrentThread();
            if (!_initialized || targetCamera == null)
            {
                _lastManagedAllocationBytes = System.GC.GetAllocatedBytesForCurrentThread() - allocationStart;
                return;
            }

            bool settingsChanged = seed != _lastSeed || !Mathf.Approximately(frequency, _lastFrequency) ||
                                   !Mathf.Approximately(heightAmplitude, _lastAmplitude);
            if (settingsChanged)
            {
                _lastSeed = seed;
                _lastFrequency = frequency;
                _lastAmplitude = heightAmplitude;
                _material.SetFloat(HeightAmplitudeId, heightAmplitude);
            }

            UpdateOrigins(settingsChanged);
            UpdateGlobalShaderState();
            DrawTerrain();
            _lastManagedAllocationBytes = System.GC.GetAllocatedBytesForCurrentThread() - allocationStart;
        }

        private void InitializeResources()
        {
            ReleaseResources();

            _heightCompute = Resources.Load<ComputeShader>(ComputeResourceName);
            Shader terrainShader = Resources.Load<Shader>(ShaderResourceName);
            if (_heightCompute == null || terrainShader == null)
            {
                Debug.LogError("[Sol GPU Terrain] Missing Sol_TerrainHeight.compute or Sol_GpuTerrain.shader in Resources.", this);
                return;
            }

            _heightKernel = _heightCompute.FindKernel("GenerateHeight");
            _heightBuffer = new ComputeBuffer(LodCount * SamplesPerLevel, sizeof(float), ComputeBufferType.Structured);
            _heightBuffer.name = "Sol_GPU_HeightBuffer";
            _material = new Material(terrainShader)
            {
                name = "Sol_Runtime_GpuTerrainMaterial",
                hideFlags = HideFlags.DontSave
            };

            int drawIndex = 0;
            ConfigureDraw(drawIndex++, 0, 0, 0, GridCells, GridCells);
            for (int level = 1; level < LodCount; level++)
            {
                const int band = GridCells / 4;
                const int middle = GridCells - band * 2;
                ConfigureDraw(drawIndex++, level, 0, 0, GridCells, band);
                ConfigureDraw(drawIndex++, level, 0, GridCells - band, GridCells, band);
                ConfigureDraw(drawIndex++, level, 0, band, band, middle);
                ConfigureDraw(drawIndex++, level, GridCells - band, band, band, middle);
            }

            _lastSeed = seed;
            _lastFrequency = frequency;
            _lastAmplitude = heightAmplitude;
            _material.SetFloat(HeightAmplitudeId, heightAmplitude);
            _initialized = true;
            UpdateOrigins(true);
            UpdateGlobalShaderState();
            Debug.Log($"[Sol GPU Terrain] Ready: {LodCount} LODs, {GridCells}x{GridCells} cells/level, " +
                      $"{CoarsestCoverageMeters:0}m coverage, {HeightBufferSampleCount} GPU height samples.", this);
        }

        private void ConfigureDraw(int drawIndex, int level, int offsetX, int offsetZ, int width, int height)
        {
            MaterialPropertyBlock block = new MaterialPropertyBlock();
            block.SetBuffer(HeightBufferId, _heightBuffer);
            block.SetInt(ResolutionId, SampleResolution);
            block.SetInt(BaseOffsetId, level * SamplesPerLevel);
            block.SetInt(LevelId, level);
            block.SetVector(PatchOffsetId, new Vector4(offsetX, offsetZ, 0.0f, 0.0f));
            block.SetVector(PatchCellsId, new Vector4(width, height, 0.0f, 0.0f));

            float cellSize = FinestCellSize * (1 << level);
            block.SetFloat(CellSizeId, cellSize);
            block.SetFloat(ParentCellSizeId, level < LodCount - 1 ? cellSize * 2.0f : cellSize);
            block.SetFloat(HasParentId, level < LodCount - 1 ? 1.0f : 0.0f);
            block.SetFloat(SkirtDepthId, Mathf.Max(minimumSkirtDepth, cellSize * 1.5f));

            _propertyBlocks[drawIndex] = block;
            _drawLevels[drawIndex] = level;
            int topVertices = width * height * 6;
            int skirtVertices = (width * 2 + height * 2) * 6;
            _vertexCounts[drawIndex] = topVertices + skirtVertices;
            _renderParams[drawIndex] = new RenderParams(_material)
            {
                // Keep this null so RenderPrimitives is visible in both Game and Scene views.
                // The target camera still drives clipmap snapping and the shader's view center.
                camera = null,
                layer = gameObject.layer,
                matProps = block,
                receiveShadows = true,
                shadowCastingMode = ShadowCastingMode.Off,
                worldBounds = new Bounds(Vector3.zero, Vector3.one * CoarsestCoverageMeters)
            };
        }

        private void UpdateOrigins(bool forceAll)
        {
            Vector3 cameraPosition = targetCamera.transform.position;

            for (int level = 0; level < LodCount; level++)
            {
                float cellSize = FinestCellSize * (1 << level);
                float snappedX = Mathf.Floor(cameraPosition.x / cellSize) * cellSize;
                float snappedZ = Mathf.Floor(cameraPosition.z / cellSize) * cellSize;
                float halfSpan = GridCells * cellSize * 0.5f;
                Vector2 origin = new Vector2(snappedX - halfSpan, snappedZ - halfSpan);
                bool moved = forceAll || !_initialized || origin != _lodOrigins[level];
                _lodDirty[level] = moved;
                if (moved)
                {
                    _lodOrigins[level] = origin;
                }
            }

            for (int level = 0; level < LodCount; level++)
            {
                if (_lodDirty[level])
                {
                    DispatchHeight(level);
                }
            }

            for (int level = 0; level < LodCount; level++)
            {
                bool parentMoved = level < LodCount - 1 && _lodDirty[level + 1];
                if (forceAll || _lodDirty[level] || parentMoved)
                {
                    UpdateLevelProperties(level);
                }
            }
        }

        private void DispatchHeight(int level)
        {
            float cellSize = FinestCellSize * (1 << level);
            _heightCompute.SetInt(ResolutionId, SampleResolution);
            _heightCompute.SetInt(BaseOffsetId, level * SamplesPerLevel);
            _heightCompute.SetInt("_Sol_Seed", seed);
            _heightCompute.SetFloat("_Sol_Frequency", frequency);
            _heightCompute.SetFloat("_Sol_Amplitude", heightAmplitude);
            _heightCompute.SetVector(LevelOriginId, _lodOrigins[level]);
            _heightCompute.SetFloat(CellSizeId, cellSize);
            _heightCompute.SetBuffer(_heightKernel, HeightBufferId, _heightBuffer);
            int groupCount = Mathf.CeilToInt(SampleResolution / 8.0f);
            _heightCompute.Dispatch(_heightKernel, groupCount, groupCount, 1);
        }

        private void UpdateLevelProperties(int level)
        {
            Vector2 parentOrigin = level < LodCount - 1 ? _lodOrigins[level + 1] : _lodOrigins[level];
            for (int draw = 0; draw < DrawCount; draw++)
            {
                if (_drawLevels[draw] != level)
                {
                    continue;
                }

                MaterialPropertyBlock block = _propertyBlocks[draw];
                block.SetVector(LevelOriginId, _lodOrigins[level]);
                block.SetVector(ParentOriginId, parentOrigin);
                float cellSize = FinestCellSize * (1 << level);
                block.SetFloat(SkirtDepthId, Mathf.Max(minimumSkirtDepth, cellSize * 1.5f));
            }
        }

        private void UpdateGlobalShaderState()
        {
            Vector3 cameraPosition = targetCamera.transform.position;
            Shader.SetGlobalVector(ViewCenterId, new Vector4(cameraPosition.x, cameraPosition.z, 0.0f, 0.0f));
            Shader.SetGlobalInt(DebugModeId, _debugMode);
            Shader.SetGlobalFloat(HeightAmplitudeId, heightAmplitude);
            Shader.SetGlobalFloat(MorphStartFractionId, morphStartFraction);
        }

        private void DrawTerrain()
        {
            Vector3 position = targetCamera.transform.position;
            float boundsHeight = heightAmplitude * 3.0f + 256.0f;
            Bounds bounds = new Bounds(
                new Vector3(position.x, 0.0f, position.z),
                new Vector3(CoarsestCoverageMeters + 256.0f, boundsHeight, CoarsestCoverageMeters + 256.0f));

            for (int draw = 0; draw < DrawCount; draw++)
            {
                _renderParams[draw].worldBounds = bounds;
                Graphics.RenderPrimitives(_renderParams[draw], MeshTopology.Triangles, _vertexCounts[draw], 1);
            }
        }

        private void ReleaseResources()
        {
            _initialized = false;
            if (_heightBuffer != null)
            {
                _heightBuffer.Release();
                _heightBuffer = null;
            }

            if (_material != null)
            {
                if (Application.isPlaying)
                {
                    Destroy(_material);
                }
                else
                {
                    DestroyImmediate(_material);
                }

                _material = null;
            }
        }

        private static string GetDebugModeName(int mode)
        {
            switch (mode)
            {
                case 1: return "LOD levels";
                case 2: return "Wireframe";
                default: return "Normal";
            }
        }
    }
}
