using UnityEngine;

namespace Luna.GpuTerrain
{
    [DisallowMultipleComponent]
    [RequireComponent(typeof(Camera))]
    public sealed class Luna_GpuTerrainBootstrap : MonoBehaviour
    {
        [SerializeField] private bool autoCreate = true;

        private void Awake()
        {
            if (!autoCreate)
            {
                return;
            }

            Camera camera = GetComponent<Camera>();
            GameObject runtimeObject = new GameObject("Luna_GpuTerrain_Runtime");
            Luna_GpuTerrainController terrain = runtimeObject.AddComponent<Luna_GpuTerrainController>();
            terrain.Initialize(camera);

            Luna_FirstPersonController firstPerson = GetComponent<Luna_FirstPersonController>();
            if (firstPerson == null)
            {
                firstPerson = gameObject.AddComponent<Luna_FirstPersonController>();
            }

            firstPerson.Initialize(terrain);
        }
    }
}
