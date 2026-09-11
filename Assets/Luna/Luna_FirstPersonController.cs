using UnityEngine;
using UnityEngine.InputSystem;

namespace Luna.GpuTerrain
{
    [RequireComponent(typeof(Camera))]
    public sealed class Luna_FirstPersonController : MonoBehaviour
    {
        [SerializeField] private float walkSpeed = 8f;
        [SerializeField] private float sprintSpeed = 40f;
        [SerializeField] private float eyeHeight = 1.7f;
        [SerializeField] private float mouseSensitivity = 0.08f;
        [SerializeField] private float autopilotSpeed = 25f;

        private readonly Vector2[] _waypoints =
        {
            new Vector2(0f, 0f),
            new Vector2(500f, 0f),
            new Vector2(500f, 500f),
            new Vector2(-500f, 500f),
            new Vector2(-500f, -500f),
            new Vector2(0f, 0f)
        };

        private Luna_GpuTerrainController _terrain;
        private Camera _camera;
        private float _yaw;
        private float _pitch = 10f;
        private bool _cursorLocked;
        private bool _autopilot;
        private int _waypointIndex = 1;

        public void Initialize(Luna_GpuTerrainController terrain)
        {
            _terrain = terrain;
        }

        private void Awake()
        {
            _camera = GetComponent<Camera>();
            _camera.fieldOfView = 75f;
            _camera.nearClipPlane = 0.1f;
            _camera.farClipPlane = 5000f;
        }

        private void Start()
        {
            if (_terrain == null)
            {
                _terrain = Object.FindFirstObjectByType<Luna_GpuTerrainController>();
            }

            Vector3 euler = transform.eulerAngles;
            _yaw = euler.y;
            _pitch = NormalizePitch(euler.x);
            if (Mathf.Abs(_pitch) < 0.1f)
            {
                _pitch = 10f;
            }
            transform.rotation = Quaternion.Euler(_pitch, _yaw, 0f);
            GroundCamera();
            SetCursorLocked(false);
        }

        private void Update()
        {
            Keyboard keyboard = Keyboard.current;
            Mouse mouse = Mouse.current;
            if (keyboard == null)
            {
                return;
            }

            if (keyboard.escapeKey.wasPressedThisFrame)
            {
                SetCursorLocked(false);
            }

            if (mouse != null && mouse.leftButton.wasPressedThisFrame)
            {
                SetCursorLocked(true);
            }

            if (keyboard.pKey.wasPressedThisFrame)
            {
                ToggleAutopilot();
            }

            if (_autopilot)
            {
                MoveAutopilot(Time.deltaTime);
            }
            else
            {
                UpdateLook(mouse);
                MoveManual(keyboard, Time.deltaTime);
            }

            GroundCamera();
        }

        private void UpdateLook(Mouse mouse)
        {
            if (!_cursorLocked || mouse == null)
            {
                return;
            }

            Vector2 delta = mouse.delta.ReadValue();
            _yaw += delta.x * mouseSensitivity;
            _pitch = Mathf.Clamp(_pitch - delta.y * mouseSensitivity, -85f, 85f);
            transform.rotation = Quaternion.Euler(_pitch, _yaw, 0f);
        }

        private void MoveManual(Keyboard keyboard, float deltaTime)
        {
            float horizontal = 0f;
            float vertical = 0f;
            if (keyboard.aKey.isPressed) horizontal -= 1f;
            if (keyboard.dKey.isPressed) horizontal += 1f;
            if (keyboard.sKey.isPressed) vertical -= 1f;
            if (keyboard.wKey.isPressed) vertical += 1f;

            Vector2 input = new Vector2(horizontal, vertical);
            if (input.sqrMagnitude > 1f)
            {
                input.Normalize();
            }

            float speed = keyboard.leftShiftKey.isPressed || keyboard.rightShiftKey.isPressed ? sprintSpeed : walkSpeed;
            float yawRadians = _yaw * Mathf.Deg2Rad;
            Vector3 forward = new Vector3(Mathf.Sin(yawRadians), 0f, Mathf.Cos(yawRadians));
            Vector3 right = new Vector3(forward.z, 0f, -forward.x);
            Vector3 displacement = (forward * input.y + right * input.x) * (speed * deltaTime);
            transform.position += displacement;
        }

        private void ToggleAutopilot()
        {
            _autopilot = !_autopilot;
            if (_autopilot)
            {
                _waypointIndex = 1;
                transform.position = new Vector3(_waypoints[0].x, transform.position.y, _waypoints[0].y);
            }
        }

        private void MoveAutopilot(float deltaTime)
        {
            float remaining = autopilotSpeed * deltaTime;
            int safety = 0;
            while (remaining > 0f && safety++ < _waypoints.Length)
            {
                Vector2 current = new Vector2(transform.position.x, transform.position.z);
                Vector2 target = _waypoints[_waypointIndex];
                Vector2 toTarget = target - current;
                float distance = toTarget.magnitude;
                if (distance < 0.001f)
                {
                    _waypointIndex = (_waypointIndex + 1) % _waypoints.Length;
                    continue;
                }

                Vector2 direction = toTarget / distance;
                float travel = Mathf.Min(remaining, distance);
                current += direction * travel;
                transform.position = new Vector3(current.x, transform.position.y, current.y);
                remaining -= travel;

                float targetYaw = Mathf.Atan2(direction.x, direction.y) * Mathf.Rad2Deg;
                _yaw = Mathf.LerpAngle(_yaw, targetYaw, 1f - Mathf.Exp(-8f * deltaTime));
                transform.rotation = Quaternion.Euler(_pitch, _yaw, 0f);
                if (travel >= distance - 0.001f)
                {
                    _waypointIndex = (_waypointIndex + 1) % _waypoints.Length;
                }
            }
        }

        private void GroundCamera()
        {
            if (_terrain == null)
            {
                return;
            }

            Vector3 position = transform.position;
            position.y = _terrain.GetTerrainHeight(position.x, position.z) + eyeHeight;
            transform.position = position;
        }

        private void SetCursorLocked(bool locked)
        {
            _cursorLocked = locked;
            Cursor.lockState = locked ? CursorLockMode.Locked : CursorLockMode.None;
            Cursor.visible = !locked;
        }

        private static float NormalizePitch(float pitch)
        {
            if (pitch > 180f) pitch -= 360f;
            return Mathf.Clamp(pitch, -85f, 85f);
        }
    }
}
