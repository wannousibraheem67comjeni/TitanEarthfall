using System.Collections.Generic;
using UnityEngine;
#if ENABLE_INPUT_SYSTEM && !ENABLE_LEGACY_INPUT_MANAGER
using UnityEngine.InputSystem;
#endif

namespace TitanEarthfall.Runner.Game
{
    /// <summary>
    /// Maps swipes (touch or mouse drag), keyboard and gamepad to runner commands. A swipe fires as soon
    /// as the finger travels far enough, which feels far more responsive than waiting for release.
    /// </summary>
    public sealed class RunnerInputReader
    {
        private const float SwipeScreenFraction = 0.045f;

        private Vector2 swipeStart;
        private bool tracking;
        private bool swipeUsed;

        public void Poll(List<RunnerCommand> commands)
        {
            ReadButtons(commands);
            ReadSwipe(commands);
        }

        public bool PausePressed()
        {
#if ENABLE_INPUT_SYSTEM && !ENABLE_LEGACY_INPUT_MANAGER
            var keyboard = Keyboard.current;
            var gamepad = Gamepad.current;
            return (keyboard != null && (keyboard.escapeKey.wasPressedThisFrame || keyboard.pKey.wasPressedThisFrame))
                || (gamepad != null && gamepad.startButton.wasPressedThisFrame);
#else
            return Input.GetKeyDown(KeyCode.Escape) || Input.GetKeyDown(KeyCode.P);
#endif
        }

        private void ReadSwipe(List<RunnerCommand> commands)
        {
            if (!TryGetPointer(out bool pressedThisFrame, out bool held, out Vector2 position))
            {
                tracking = false;
                return;
            }
            if (pressedThisFrame)
            {
                swipeStart = position;
                tracking = true;
                swipeUsed = false;
                return;
            }
            if (!held)
            {
                tracking = false;
                return;
            }
            if (!tracking || swipeUsed) return;

            var delta = position - swipeStart;
            float threshold = Mathf.Max(30f, Mathf.Min(Screen.width, Screen.height) * SwipeScreenFraction * 1.6f);
            if (delta.magnitude < threshold) return;
            swipeUsed = true;
            if (Mathf.Abs(delta.x) > Mathf.Abs(delta.y)) commands.Add(delta.x > 0f ? RunnerCommand.Right : RunnerCommand.Left);
            else commands.Add(delta.y > 0f ? RunnerCommand.Jump : RunnerCommand.Roll);
        }

#if ENABLE_INPUT_SYSTEM && !ENABLE_LEGACY_INPUT_MANAGER
        private static void ReadButtons(List<RunnerCommand> commands)
        {
            var keyboard = Keyboard.current;
            if (keyboard != null)
            {
                if (keyboard.leftArrowKey.wasPressedThisFrame || keyboard.aKey.wasPressedThisFrame) commands.Add(RunnerCommand.Left);
                if (keyboard.rightArrowKey.wasPressedThisFrame || keyboard.dKey.wasPressedThisFrame) commands.Add(RunnerCommand.Right);
                if (keyboard.upArrowKey.wasPressedThisFrame || keyboard.wKey.wasPressedThisFrame || keyboard.spaceKey.wasPressedThisFrame) commands.Add(RunnerCommand.Jump);
                if (keyboard.downArrowKey.wasPressedThisFrame || keyboard.sKey.wasPressedThisFrame) commands.Add(RunnerCommand.Roll);
            }
            var gamepad = Gamepad.current;
            if (gamepad != null)
            {
                if (gamepad.dpad.left.wasPressedThisFrame || gamepad.leftShoulder.wasPressedThisFrame) commands.Add(RunnerCommand.Left);
                if (gamepad.dpad.right.wasPressedThisFrame || gamepad.rightShoulder.wasPressedThisFrame) commands.Add(RunnerCommand.Right);
                if (gamepad.dpad.up.wasPressedThisFrame || gamepad.buttonSouth.wasPressedThisFrame) commands.Add(RunnerCommand.Jump);
                if (gamepad.dpad.down.wasPressedThisFrame || gamepad.buttonEast.wasPressedThisFrame) commands.Add(RunnerCommand.Roll);
            }
        }

        private static bool TryGetPointer(out bool pressedThisFrame, out bool held, out Vector2 position)
        {
            var touchscreen = Touchscreen.current;
            if (touchscreen != null && (touchscreen.primaryTouch.press.isPressed || touchscreen.primaryTouch.press.wasReleasedThisFrame))
            {
                pressedThisFrame = touchscreen.primaryTouch.press.wasPressedThisFrame;
                held = touchscreen.primaryTouch.press.isPressed;
                position = touchscreen.primaryTouch.position.ReadValue();
                return true;
            }
            var mouse = Mouse.current;
            if (mouse != null)
            {
                pressedThisFrame = mouse.leftButton.wasPressedThisFrame;
                held = mouse.leftButton.isPressed;
                position = mouse.position.ReadValue();
                return true;
            }
            pressedThisFrame = held = false;
            position = default;
            return false;
        }
#else
        private static void ReadButtons(List<RunnerCommand> commands)
        {
            if (Input.GetKeyDown(KeyCode.LeftArrow) || Input.GetKeyDown(KeyCode.A)) commands.Add(RunnerCommand.Left);
            if (Input.GetKeyDown(KeyCode.RightArrow) || Input.GetKeyDown(KeyCode.D)) commands.Add(RunnerCommand.Right);
            if (Input.GetKeyDown(KeyCode.UpArrow) || Input.GetKeyDown(KeyCode.W) || Input.GetKeyDown(KeyCode.Space)) commands.Add(RunnerCommand.Jump);
            if (Input.GetKeyDown(KeyCode.DownArrow) || Input.GetKeyDown(KeyCode.S)) commands.Add(RunnerCommand.Roll);
            if (Input.GetKeyDown(KeyCode.JoystickButton4)) commands.Add(RunnerCommand.Left);
            if (Input.GetKeyDown(KeyCode.JoystickButton5)) commands.Add(RunnerCommand.Right);
            if (Input.GetKeyDown(KeyCode.JoystickButton0)) commands.Add(RunnerCommand.Jump);
            if (Input.GetKeyDown(KeyCode.JoystickButton1)) commands.Add(RunnerCommand.Roll);
        }

        private static bool TryGetPointer(out bool pressedThisFrame, out bool held, out Vector2 position)
        {
            if (Input.touchCount > 0)
            {
                var touch = Input.GetTouch(0);
                pressedThisFrame = touch.phase == TouchPhase.Began;
                held = touch.phase != TouchPhase.Ended && touch.phase != TouchPhase.Canceled;
                position = touch.position;
                return true;
            }
            pressedThisFrame = Input.GetMouseButtonDown(0);
            held = Input.GetMouseButton(0);
            position = Input.mousePosition;
            return true;
        }
#endif
    }
}
