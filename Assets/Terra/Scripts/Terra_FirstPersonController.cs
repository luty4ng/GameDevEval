using UnityEngine;
using UnityEngine.InputSystem;

namespace Terra.GpuTerrain
{
    [RequireComponent(typeof(Camera))]
    [DefaultExecutionOrder(-50)]
    public sealed class TerraFirstPersonController : MonoBehaviour
    {
        private static readonly Vector2[] AutopilotWaypoints =
        {
            new Vector2(0f, 0f),
            new Vector2(500f, 0f),
            new Vector2(500f, 500f),
            new Vector2(-500f, 500f),
            new Vector2(-500f, -500f),
            new Vector2(0f, 0f)
        };

        [SerializeField, Min(0.1f)] private float moveSpeed = 8f;
        [SerializeField, Min(0.1f)] private float sprintSpeed = 40f;
        [SerializeField, Min(0.1f)] private float autopilotSpeed = 25f;
        [SerializeField, Min(0.1f)] private float eyeHeight = 1.7f;
        [SerializeField, Min(0.01f)] private float mouseSensitivity = 0.12f;

        private TerraGpuTerrainRenderer terrain;
        private Camera controlledCamera;
        private float yaw;
        private float pitch;
        private int autopilotTargetIndex;
        private bool autopilot;

        private void Awake()
        {
            controlledCamera = GetComponent<Camera>();
            terrain = Object.FindFirstObjectByType<TerraGpuTerrainRenderer>();
            if (terrain == null)
            {
                Debug.LogError("Terra first-person camera could not find Terra_GpuTerrainSystem.", this);
                enabled = false;
                return;
            }

            terrain.SetDriverCamera(controlledCamera);
            Vector3 initialPosition = transform.position;
            initialPosition.y = terrain.EyeHeightSample(initialPosition) + eyeHeight;
            transform.position = initialPosition;
            yaw = transform.eulerAngles.y;
            pitch = transform.eulerAngles.x > 180f ? transform.eulerAngles.x - 360f : transform.eulerAngles.x;
        }

        private void Update()
        {
            Keyboard keyboard = Keyboard.current;
            if (keyboard == null)
                return;

            if (keyboard.f1Key.wasPressedThisFrame)
            {
                // The terrain renderer owns the F1 mode; this branch makes no state change here.
            }

            if (keyboard.pKey.wasPressedThisFrame)
                SetAutopilot(!autopilot);

            if (autopilot)
            {
                UpdateAutopilot(Time.deltaTime);
                return;
            }

            UpdateCursorLock(keyboard);
            if (Cursor.lockState == CursorLockMode.Locked)
            {
                UpdateLook();
                UpdateManualMovement(keyboard, Time.deltaTime);
            }

            ConformToTerrain();
        }

        private void UpdateCursorLock(Keyboard keyboard)
        {
            if (keyboard.escapeKey.wasPressedThisFrame)
            {
                Cursor.lockState = CursorLockMode.None;
                Cursor.visible = true;
            }

            Mouse mouse = Mouse.current;
            if (mouse != null && mouse.leftButton.wasPressedThisFrame)
            {
                Cursor.lockState = CursorLockMode.Locked;
                Cursor.visible = false;
            }
        }

        private void UpdateLook()
        {
            Mouse mouse = Mouse.current;
            if (mouse == null)
                return;

            Vector2 delta = mouse.delta.ReadValue();
            yaw += delta.x * mouseSensitivity;
            pitch = Mathf.Clamp(pitch - delta.y * mouseSensitivity, -88f, 88f);
            transform.rotation = Quaternion.Euler(pitch, yaw, 0f);
        }

        private void UpdateManualMovement(Keyboard keyboard, float deltaTime)
        {
            float horizontal = (keyboard.dKey.isPressed ? 1f : 0f) - (keyboard.aKey.isPressed ? 1f : 0f);
            float vertical = (keyboard.wKey.isPressed ? 1f : 0f) - (keyboard.sKey.isPressed ? 1f : 0f);
            Vector3 forward = transform.forward;
            forward.y = 0f;
            forward.Normalize();
            Vector3 right = transform.right;
            right.y = 0f;
            right.Normalize();
            Vector3 movement = forward * vertical + right * horizontal;
            if (movement.sqrMagnitude > 1f)
                movement.Normalize();

            bool sprinting = keyboard.leftShiftKey.isPressed || keyboard.rightShiftKey.isPressed;
            transform.position += movement * (sprinting ? sprintSpeed : moveSpeed) * deltaTime;
        }

        private void SetAutopilot(bool enabled)
        {
            autopilot = enabled;
            if (!enabled)
                return;

            // Starting at waypoint zero makes the requested loop deterministic regardless of prior free movement.
            Vector3 start = transform.position;
            start.x = AutopilotWaypoints[0].x;
            start.z = AutopilotWaypoints[0].y;
            start.y = terrain.EyeHeightSample(start) + eyeHeight;
            transform.position = start;
            autopilotTargetIndex = 1;
            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible = false;
        }

        private void UpdateAutopilot(float deltaTime)
        {
            float remainingTravel = autopilotSpeed * deltaTime;
            Vector3 position = transform.position;
            Vector3 facing = transform.forward;

            // A while loop preserves 25m/s when one frame crosses a waypoint; it has a fixed six-iteration cap.
            for (int pass = 0; pass < AutopilotWaypoints.Length && remainingTravel > 0f; pass++)
            {
                Vector2 target = AutopilotWaypoints[autopilotTargetIndex];
                Vector2 delta = target - new Vector2(position.x, position.z);
                float distance = delta.magnitude;
                if (distance < 0.0001f)
                {
                    autopilotTargetIndex = (autopilotTargetIndex + 1) % AutopilotWaypoints.Length;
                    continue;
                }

                Vector2 direction = delta / distance;
                facing = new Vector3(direction.x, 0f, direction.y);
                float step = Mathf.Min(remainingTravel, distance);
                position.x += direction.x * step;
                position.z += direction.y * step;
                remainingTravel -= step;
                if (step >= distance)
                    autopilotTargetIndex = (autopilotTargetIndex + 1) % AutopilotWaypoints.Length;
            }

            position.y = terrain.EyeHeightSample(position) + eyeHeight;
            transform.position = position;
            if (facing.sqrMagnitude > 0.0001f)
            {
                Quaternion desiredRotation = Quaternion.LookRotation(facing, Vector3.up);
                transform.rotation = Quaternion.Slerp(transform.rotation, desiredRotation, 1f - Mathf.Exp(-8f * deltaTime));
            }
        }

        private void ConformToTerrain()
        {
            Vector3 position = transform.position;
            position.y = terrain.EyeHeightSample(position) + eyeHeight;
            transform.position = position;
        }

        private void OnDisable()
        {
            if (!autopilot)
            {
                Cursor.lockState = CursorLockMode.None;
                Cursor.visible = true;
            }
        }
    }
}
