using UnityEngine;
using UnityEngine.InputSystem;

namespace Sol.GpuTerrain
{
    [DisallowMultipleComponent]
    [RequireComponent(typeof(Camera))]
    public sealed class Sol_FirstPersonController : MonoBehaviour
    {
        private static readonly Vector2[] AutopilotWaypoints =
        {
            new Vector2(0.0f, 0.0f),
            new Vector2(500.0f, 0.0f),
            new Vector2(500.0f, 500.0f),
            new Vector2(-500.0f, 500.0f),
            new Vector2(-500.0f, -500.0f),
            new Vector2(0.0f, 0.0f)
        };

        [Header("Manual movement")]
        [SerializeField, Min(0.1f)] private float moveSpeed = 8.0f;
        [SerializeField, Min(0.1f)] private float sprintSpeed = 40.0f;
        [SerializeField, Min(0.01f)] private float mouseSensitivity = 0.12f;
        [SerializeField, Range(10.0f, 89.0f)] private float pitchLimit = 88.0f;

        [Header("Ground constraint")]
        [SerializeField, Min(0.1f)] private float eyeHeight = 1.7f;

        [Header("Autopilot")]
        [SerializeField, Min(0.1f)] private float autopilotSpeed = 25.0f;
        [SerializeField, Min(0.1f)] private float autopilotTurnSharpness = 5.0f;

        private Sol_GpuTerrainSystem _terrain;
        private float _yaw;
        private float _pitch;
        private bool _autopilotEnabled;
        private int _autopilotTargetIndex = 1;
        private long _lastManagedAllocationBytes;

        public bool AutopilotEnabled => _autopilotEnabled;
        public int AutopilotTargetIndex => _autopilotTargetIndex;
        public float EyeHeight => eyeHeight;
        public long LastManagedAllocationBytes => _lastManagedAllocationBytes;

        public void Initialize(Sol_GpuTerrainSystem terrain)
        {
            _terrain = terrain;
            FollowGround();
        }

        private void Awake()
        {
            Vector3 euler = transform.eulerAngles;
            _yaw = euler.y;
            _pitch = NormalizePitch(euler.x);
            SetCursorLocked(false);
        }

        private void Start()
        {
            if (_terrain == null)
            {
                _terrain = FindFirstObjectByType<Sol_GpuTerrainSystem>();
            }

            FollowGround();
        }

        private void OnDisable()
        {
            SetCursorLocked(false);
        }

        private void Update()
        {
            long allocationStart = System.GC.GetAllocatedBytesForCurrentThread();
            Keyboard keyboard = Keyboard.current;
            Mouse mouse = Mouse.current;

            if (keyboard != null)
            {
                if (keyboard.escapeKey.wasPressedThisFrame)
                {
                    SetCursorLocked(false);
                }

                if (keyboard.f1Key.wasPressedThisFrame)
                {
                    _terrain?.CycleDebugMode();
                }

                if (keyboard.pKey.wasPressedThisFrame)
                {
                    ToggleAutopilot();
                }
            }

            if (mouse != null && mouse.leftButton.wasPressedThisFrame)
            {
                SetCursorLocked(true);
            }

            if (_autopilotEnabled)
            {
                UpdateAutopilot(Time.deltaTime);
            }
            else
            {
                UpdateManualInput(keyboard, mouse, Time.deltaTime);
            }

            FollowGround();
            _lastManagedAllocationBytes = System.GC.GetAllocatedBytesForCurrentThread() - allocationStart;
        }

        private void UpdateManualInput(Keyboard keyboard, Mouse mouse, float deltaTime)
        {
            if (mouse != null && Cursor.lockState == CursorLockMode.Locked)
            {
                Vector2 lookDelta = mouse.delta.ReadValue();
                _yaw += lookDelta.x * mouseSensitivity;
                _pitch = Mathf.Clamp(_pitch - lookDelta.y * mouseSensitivity, -pitchLimit, pitchLimit);
            }

            transform.rotation = Quaternion.Euler(_pitch, _yaw, 0.0f);
            if (keyboard == null)
            {
                return;
            }

            float inputX = (keyboard.dKey.isPressed ? 1.0f : 0.0f) - (keyboard.aKey.isPressed ? 1.0f : 0.0f);
            float inputZ = (keyboard.wKey.isPressed ? 1.0f : 0.0f) - (keyboard.sKey.isPressed ? 1.0f : 0.0f);
            Vector2 input = new Vector2(inputX, inputZ);
            if (input.sqrMagnitude > 1.0f)
            {
                input.Normalize();
            }

            Quaternion yawRotation = Quaternion.Euler(0.0f, _yaw, 0.0f);
            Vector3 move = yawRotation * new Vector3(input.x, 0.0f, input.y);
            float speed = keyboard.shiftKey.isPressed ? sprintSpeed : moveSpeed;
            transform.position += move * (speed * deltaTime);
        }

        private void ToggleAutopilot()
        {
            _autopilotEnabled = !_autopilotEnabled;
            if (_autopilotEnabled)
            {
                Vector3 position = transform.position;
                position.x = AutopilotWaypoints[0].x;
                position.z = AutopilotWaypoints[0].y;
                transform.position = position;
                _autopilotTargetIndex = 1;
                FollowGround();
            }

            Debug.Log($"[Sol GPU Terrain] Autopilot {(_autopilotEnabled ? "enabled" : "disabled")}", this);
        }

        private void UpdateAutopilot(float deltaTime)
        {
            Vector3 position = transform.position;
            Vector2 current = new Vector2(position.x, position.z);
            float remainingDistance = autopilotSpeed * deltaTime;
            Vector2 travelDirection = Vector2.zero;

            // Consuming the residual distance preserves exactly 25 m/s even on a waypoint-crossing frame.
            for (int guard = 0; guard < AutopilotWaypoints.Length && remainingDistance > 0.0f; guard++)
            {
                Vector2 target = AutopilotWaypoints[_autopilotTargetIndex];
                Vector2 toTarget = target - current;
                float distance = toTarget.magnitude;
                if (distance <= 0.0001f)
                {
                    AdvanceAutopilotWaypoint();
                    continue;
                }

                travelDirection = toTarget / distance;
                if (remainingDistance < distance)
                {
                    current += travelDirection * remainingDistance;
                    remainingDistance = 0.0f;
                }
                else
                {
                    current = target;
                    remainingDistance -= distance;
                    AdvanceAutopilotWaypoint();
                }
            }

            position.x = current.x;
            position.z = current.y;
            transform.position = position;

            if (travelDirection.sqrMagnitude > 0.0f)
            {
                Quaternion targetRotation = Quaternion.LookRotation(
                    new Vector3(travelDirection.x, 0.0f, travelDirection.y), Vector3.up);
                float blend = 1.0f - Mathf.Exp(-autopilotTurnSharpness * deltaTime);
                transform.rotation = Quaternion.Slerp(transform.rotation, targetRotation, blend);
                Vector3 euler = transform.eulerAngles;
                _yaw = euler.y;
                _pitch = NormalizePitch(euler.x);
            }
        }

        private void AdvanceAutopilotWaypoint()
        {
            _autopilotTargetIndex++;
            if (_autopilotTargetIndex >= AutopilotWaypoints.Length)
            {
                // Index 5 already is the repeated (0,0) endpoint, so resume at (500,0).
                _autopilotTargetIndex = 1;
            }
        }

        private void FollowGround()
        {
            if (_terrain == null)
            {
                return;
            }

            Vector3 position = transform.position;
            position.y = _terrain.SampleHeightCpu(position.x, position.z) + eyeHeight;
            transform.position = position;
        }

        private static void SetCursorLocked(bool locked)
        {
            Cursor.lockState = locked ? CursorLockMode.Locked : CursorLockMode.None;
            Cursor.visible = !locked;
        }

        private static float NormalizePitch(float angle)
        {
            return angle > 180.0f ? angle - 360.0f : angle;
        }
    }
}
