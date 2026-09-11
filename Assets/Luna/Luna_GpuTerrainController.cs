using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Rendering;

namespace Luna.GpuTerrain
{
    public sealed class Luna_GpuTerrainController : MonoBehaviour
    {
        private const int LevelCount = 6;
        private const int GridResolution = 128;
        private const int HeightTextureResolution = 1024;
        private const float HeightTextureWorldSize = 4096f;
        private const float HeightUpdateSnap = 64f;

        [Header("FBM height field")]
        [SerializeField] private int terrainSeed = 20260912;
        [SerializeField, Min(0.0001f)] private float baseFrequency = 0.0008f;
        [SerializeField, Min(80f)] private float heightAmplitude = 96f;

        [Header("Clipmap")]
        [SerializeField, Range(0f, 1f)] private float heightTextureInfluence = 1f;
        [SerializeField, Min(0.1f)] private float morphWidthInCells = 8f;

        private static readonly int HeightTexId = Shader.PropertyToID("_HeightTex");
        private static readonly int HeightOriginId = Shader.PropertyToID("_HeightWorldOrigin");
        private static readonly int HeightWorldSizeId = Shader.PropertyToID("_HeightWorldSize");
        private static readonly int HeightAmplitudeId = Shader.PropertyToID("_HeightAmplitude");
        private static readonly int BaseFrequencyId = Shader.PropertyToID("_BaseFrequency");
        private static readonly int TerrainSeedId = Shader.PropertyToID("_TerrainSeed");
        private static readonly int CameraWorldXZId = Shader.PropertyToID("_CameraWorldXZ");
        private static readonly int GridSpacingId = Shader.PropertyToID("_GridSpacing");
        private static readonly int RingInnerId = Shader.PropertyToID("_RingInner");
        private static readonly int RingOuterId = Shader.PropertyToID("_RingOuter");
        private static readonly int MorphWidthId = Shader.PropertyToID("_MorphWidth");
        private static readonly int LevelId = Shader.PropertyToID("_Level");
        private static readonly int DebugModeId = Shader.PropertyToID("_DebugMode");
        private static readonly int HeightTextureInfluenceId = Shader.PropertyToID("_HeightTextureInfluence");

        private readonly float[] _ringSpacing = new float[LevelCount];
        private readonly Transform[] _ringTransforms = new Transform[LevelCount];
        private readonly Renderer[] _ringRenderers = new Renderer[LevelCount];
        private readonly MaterialPropertyBlock[] _ringBlocks = new MaterialPropertyBlock[LevelCount];
        private readonly Material[] _ringMaterials = new Material[LevelCount];

        private Camera _camera;
        private Mesh _gridMesh;
        private Material _terrainMaterial;
        private RenderTexture _heightTexture;
        private ComputeShader _heightCompute;
        private int _heightKernel = -1;
        private int _debugMode;
        private float _heightFieldCenterX = float.NaN;
        private float _heightFieldCenterZ = float.NaN;
        private float _heightOriginX;
        private float _heightOriginZ;

        public void Initialize(Camera camera)
        {
            _camera = camera;
            UpdateHeightField(true);
            UpdateRingTransforms(true);
        }

        private void Awake()
        {
            _heightCompute = Resources.Load<ComputeShader>("Luna_GpuTerrain");
            if (_heightCompute != null)
            {
                _heightKernel = _heightCompute.FindKernel("CSGenerateHeight");
            }

            CreateHeightTexture();
            CreateTerrainResources();
        }

        private void Update()
        {
            Keyboard keyboard = Keyboard.current;
            if (keyboard != null && keyboard.f1Key.wasPressedThisFrame)
            {
                _debugMode = (_debugMode + 1) % 3;
            }
        }

        private void LateUpdate()
        {
            UpdateHeightField(false);
            UpdateRingTransforms(false);
        }

        private void CreateHeightTexture()
        {
            _heightTexture = new RenderTexture(
                HeightTextureResolution,
                HeightTextureResolution,
                0,
                RenderTextureFormat.RFloat,
                RenderTextureReadWrite.Linear)
            {
                name = "Luna_GpuTerrain_GPUHeightField",
                enableRandomWrite = true,
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp,
                useMipMap = false,
                autoGenerateMips = false
            };
            _heightTexture.Create();
        }

        private void CreateTerrainResources()
        {
            Shader terrainShader = Shader.Find("Luna/GpuTerrain");
            Material materialAsset = Resources.Load<Material>("Luna_GpuTerrain");
            if (terrainShader == null && materialAsset == null)
            {
                Debug.LogError("Luna GPU terrain shader could not be found.");
                return;
            }

            _terrainMaterial = materialAsset != null ? new Material(materialAsset) : new Material(terrainShader);
            _terrainMaterial.name = "Luna_GpuTerrain_RuntimeMaterial";
            _terrainMaterial.enableInstancing = true;
            /*
             * The material asset is kept in Resources for a self-contained scene; the runtime copy
             * receives the camera-relative GPU field through property blocks without mutating the asset.
             */
            /* This avoids shared-material state leaking between the six independently snapped rings. */
            _terrainMaterial.hideFlags = HideFlags.DontSave;
            _gridMesh = CreateGridMesh();

            for (int level = 0; level < LevelCount; level++)
            {
                _ringSpacing[level] = Mathf.Pow(2f, level);
                GameObject ringObject = new GameObject($"Luna_GpuTerrain_LOD{level}");
                ringObject.transform.SetParent(transform, false);
                // One static 128-cell topology becomes the six required metre scales through GPU vertex displacement.
                ringObject.transform.localScale = new Vector3(_ringSpacing[level], 1f, _ringSpacing[level]);
                MeshFilter filter = ringObject.AddComponent<MeshFilter>();
                filter.sharedMesh = _gridMesh;
                MeshRenderer renderer = ringObject.AddComponent<MeshRenderer>();
                Material ringMaterial = new Material(_terrainMaterial)
                {
                    name = $"Luna_GpuTerrain_RuntimeMaterial_LOD{level}",
                    // The overlap band is intentional; draw coarse rings first so the finer ring wins the depth tie.
                    renderQueue = 2000 + (LevelCount - level)
                };
                _ringMaterials[level] = ringMaterial;
                renderer.sharedMaterial = ringMaterial;
                renderer.shadowCastingMode = ShadowCastingMode.Off;
                renderer.receiveShadows = false;
                _ringTransforms[level] = ringObject.transform;
                _ringRenderers[level] = renderer;
                _ringBlocks[level] = new MaterialPropertyBlock();
            }
        }

        private Mesh CreateGridMesh()
        {
            int vertexSide = GridResolution + 1;
            Vector3[] vertices = new Vector3[vertexSide * vertexSide];
            Vector2[] uvs = new Vector2[vertices.Length];
            int[] indices = new int[GridResolution * GridResolution * 6];

            for (int z = 0; z <= GridResolution; z++)
            {
                for (int x = 0; x <= GridResolution; x++)
                {
                    int index = z * vertexSide + x;
                    float u = x / (float)GridResolution;
                    float v = z / (float)GridResolution;
                    vertices[index] = new Vector3((u - 0.5f) * GridResolution, 0f, (v - 0.5f) * GridResolution);
                    uvs[index] = new Vector2(u, v);
                }
            }

            int cursor = 0;
            for (int z = 0; z < GridResolution; z++)
            {
                for (int x = 0; x < GridResolution; x++)
                {
                    int a = z * vertexSide + x;
                    int b = a + 1;
                    int c = a + vertexSide;
                    int d = c + 1;
                    indices[cursor++] = a;
                    indices[cursor++] = c;
                    indices[cursor++] = d;
                    indices[cursor++] = a;
                    indices[cursor++] = d;
                    indices[cursor++] = b;
                }
            }

            Mesh mesh = new Mesh
            {
                name = "Luna_GpuTerrain_Grid128",
                indexFormat = IndexFormat.UInt32
            };
            mesh.vertices = vertices;
            mesh.uv = uvs;
            mesh.SetIndices(indices, MeshTopology.Triangles, 0, true);
            // Unity recalculates bounds when topology is assigned; restore a conservative vertical bound for GPU displacement.
            mesh.bounds = new Bounds(Vector3.zero, new Vector3(128f, 256f, 128f));
            mesh.UploadMeshData(false);
            return mesh;
        }

        private void UpdateHeightField(bool force)
        {
            if (_camera == null)
            {
                return;
            }

            Vector3 cameraPosition = _camera.transform.position;
            float centerX = Mathf.Floor(cameraPosition.x / HeightUpdateSnap) * HeightUpdateSnap;
            float centerZ = Mathf.Floor(cameraPosition.z / HeightUpdateSnap) * HeightUpdateSnap;
            if (!force && centerX == _heightFieldCenterX && centerZ == _heightFieldCenterZ)
            {
                return;
            }

            _heightFieldCenterX = centerX;
            _heightFieldCenterZ = centerZ;
            _heightOriginX = centerX - HeightTextureWorldSize * 0.5f;
            _heightOriginZ = centerZ - HeightTextureWorldSize * 0.5f;

            if (_heightCompute == null || _heightKernel < 0 || _heightTexture == null)
            {
                return;
            }

            _heightCompute.SetInt("_HeightResolution", HeightTextureResolution);
            _heightCompute.SetVector("_HeightWorldOrigin", new Vector4(_heightOriginX, _heightOriginZ, 0f, 0f));
            _heightCompute.SetFloat("_HeightWorldSize", HeightTextureWorldSize);
            _heightCompute.SetFloat("_TerrainSeed", terrainSeed);
            _heightCompute.SetFloat("_BaseFrequency", baseFrequency);
            _heightCompute.SetTexture(_heightKernel, "_HeightResult", _heightTexture);
            int groups = (HeightTextureResolution + 7) / 8;
            _heightCompute.Dispatch(_heightKernel, groups, groups, 1);
        }

        private void UpdateRingTransforms(bool force)
        {
            if (_camera == null || _terrainMaterial == null)
            {
                return;
            }

            Vector3 cameraPosition = _camera.transform.position;
            Vector4 cameraWorldXZ = new Vector4(cameraPosition.x, cameraPosition.z, 0f, 0f);
            for (int level = 0; level < LevelCount; level++)
            {
                float spacing = _ringSpacing[level];
                float snapX = Mathf.Floor(cameraPosition.x / spacing) * spacing;
                float snapZ = Mathf.Floor(cameraPosition.z / spacing) * spacing;
                Transform ringTransform = _ringTransforms[level];
                Vector3 current = ringTransform.position;
                if (force || current.x != snapX || current.z != snapZ)
                {
                    ringTransform.position = new Vector3(snapX, 0f, snapZ);
                }

                float outer = GridResolution * 0.5f * spacing;
                float inner = level == 0 ? -0.5f : GridResolution * 0.5f * _ringSpacing[level - 1];
                MaterialPropertyBlock block = _ringBlocks[level];
                block.SetTexture(HeightTexId, _heightTexture);
                block.SetVector(HeightOriginId, new Vector4(_heightOriginX, _heightOriginZ, 0f, 0f));
                block.SetFloat(HeightWorldSizeId, HeightTextureWorldSize);
                block.SetFloat(HeightAmplitudeId, heightAmplitude);
                block.SetFloat(BaseFrequencyId, baseFrequency);
                block.SetFloat(TerrainSeedId, terrainSeed);
                block.SetVector(CameraWorldXZId, cameraWorldXZ);
                block.SetFloat(GridSpacingId, spacing);
                block.SetFloat(RingInnerId, inner);
                block.SetFloat(RingOuterId, outer);
                block.SetFloat(MorphWidthId, spacing * morphWidthInCells);
                block.SetFloat(LevelId, level);
                block.SetFloat(DebugModeId, _debugMode);
                block.SetFloat(HeightTextureInfluenceId, heightTextureInfluence);
                _ringRenderers[level].SetPropertyBlock(block);
            }
        }

        public void SetDebugMode(int mode)
        {
            _debugMode = Mathf.Abs(mode) % 3;
            UpdateRingTransforms(true);
        }

        public int GetDebugMode()
        {
            return _debugMode;
        }

        public float GetTerrainHeight(float worldX, float worldZ)
        {
            return EvaluateCpuHeight(new Vector2(worldX, worldZ), terrainSeed, baseFrequency, heightAmplitude);
        }

        public static float EvaluateCpuHeight(Vector2 worldXZ, int seed, float frequency, float amplitude)
        {
            float sum = 0f;
            float octaveAmplitude = 0.5f;
            float octaveFrequency = frequency;
            float normalizer = 0f;
            for (int octave = 0; octave < 6; octave++)
            {
                sum += ValueNoise(worldXZ * octaveFrequency, seed + octave * 19.19f) * octaveAmplitude;
                normalizer += octaveAmplitude;
                octaveFrequency *= 2.02f;
                octaveAmplitude *= 0.5f;
            }

            return (sum / normalizer * 2f - 1f) * amplitude;
        }

        private static float ValueNoise(Vector2 point, float seed)
        {
            float seedOffset = Frac(seed * 0.000001f) * 100f;
            point += Vector2.one * seedOffset;
            Vector2 integer = new Vector2(Mathf.Floor(point.x), Mathf.Floor(point.y));
            Vector2 fraction = new Vector2(point.x - integer.x, point.y - integer.y);
            Vector2 smooth = Vector2.Scale(fraction, fraction);
            smooth = Vector2.Scale(smooth, Vector2.one * 3f - fraction * 2f);
            fraction = smooth;
            float a = Hash21(integer);
            float b = Hash21(integer + Vector2.right);
            float c = Hash21(integer + Vector2.up);
            float d = Hash21(integer + Vector2.one);
            return Mathf.Lerp(Mathf.Lerp(a, b, fraction.x), Mathf.Lerp(c, d, fraction.x), fraction.y);
        }

        private static float Hash21(Vector2 point)
        {
            point = new Vector2(Frac(point.x * 123.34f), Frac(point.y * 345.45f));
            float dot = Vector2.Dot(point, point + Vector2.one * 34.345f);
            point += Vector2.one * dot;
            return Frac(point.x * point.y);
        }

        private static float Frac(float value)
        {
            return value - Mathf.Floor(value);
        }

        private void OnDestroy()
        {
            if (_heightTexture != null)
            {
                _heightTexture.Release();
                Destroy(_heightTexture);
            }

            if (_terrainMaterial != null)
            {
                Destroy(_terrainMaterial);
            }

            for (int level = 0; level < LevelCount; level++)
            {
                if (_ringMaterials[level] != null)
                {
                    Destroy(_ringMaterials[level]);
                }
            }

            if (_gridMesh != null)
            {
                Destroy(_gridMesh);
            }
        }
    }
}
