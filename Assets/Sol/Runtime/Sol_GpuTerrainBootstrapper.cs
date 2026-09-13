using UnityEngine;

namespace Sol.GpuTerrain
{
    [DisallowMultipleComponent]
    public sealed class Sol_GpuTerrainBootstrapper : MonoBehaviour
    {
        [SerializeField] private Camera targetCamera;

        private void Awake()
        {
            // Automated acceptance may keep the Editor unfocused; continue simulation without touching PlayerSettings.
            Application.runInBackground = true;

            if (targetCamera == null)
            {
                targetCamera = Camera.main;
            }

            if (targetCamera == null)
            {
                Debug.LogError("[Sol GPU Terrain] A MainCamera is required.", this);
                enabled = false;
                return;
            }

            targetCamera.nearClipPlane = 0.1f;
            targetCamera.farClipPlane = 6000.0f;

            Sol_GpuTerrainSystem terrain = GetComponent<Sol_GpuTerrainSystem>();
            if (terrain == null)
            {
                terrain = gameObject.AddComponent<Sol_GpuTerrainSystem>();
            }

            terrain.SetTargetCamera(targetCamera);

            Sol_FirstPersonController controller = targetCamera.GetComponent<Sol_FirstPersonController>();
            if (controller == null)
            {
                controller = targetCamera.gameObject.AddComponent<Sol_FirstPersonController>();
            }

            controller.Initialize(terrain);
        }
    }
}
