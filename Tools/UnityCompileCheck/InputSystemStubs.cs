// Minimal shapes of the com.unity.inputsystem API used by the project, so the ENABLE_INPUT_SYSTEM
// code paths can be type-checked without the package. Only compiled with -p:InputSystem=true.
namespace UnityEngine.InputSystem.Controls
{
    public class ButtonControl
    {
        public bool isPressed => false;
        public bool wasPressedThisFrame => false;
        public bool wasReleasedThisFrame => false;
    }

    public sealed class KeyControl : ButtonControl { }

    public sealed class TouchPressControl : ButtonControl { }

    public class Vector2Control
    {
        public Vector2 ReadValue() => default;
    }

    public sealed class StickControl : Vector2Control { }

    public sealed class DpadControl : Vector2Control
    {
        public ButtonControl up { get; } = new ButtonControl();
        public ButtonControl down { get; } = new ButtonControl();
        public ButtonControl left { get; } = new ButtonControl();
        public ButtonControl right { get; } = new ButtonControl();
    }

    public sealed class TouchControl
    {
        public TouchPressControl press { get; } = new TouchPressControl();
        public Vector2Control position { get; } = new Vector2Control();
    }
}

namespace UnityEngine.InputSystem
{
    using UnityEngine.InputSystem.Controls;

    public sealed class Keyboard
    {
        public static Keyboard current => null;
        public KeyControl aKey { get; } = new KeyControl();
        public KeyControl cKey { get; } = new KeyControl();
        public KeyControl dKey { get; } = new KeyControl();
        public KeyControl eKey { get; } = new KeyControl();
        public KeyControl pKey { get; } = new KeyControl();
        public KeyControl sKey { get; } = new KeyControl();
        public KeyControl wKey { get; } = new KeyControl();
        public KeyControl spaceKey { get; } = new KeyControl();
        public KeyControl escapeKey { get; } = new KeyControl();
        public KeyControl leftCtrlKey { get; } = new KeyControl();
        public KeyControl leftShiftKey { get; } = new KeyControl();
        public KeyControl leftArrowKey { get; } = new KeyControl();
        public KeyControl rightArrowKey { get; } = new KeyControl();
        public KeyControl upArrowKey { get; } = new KeyControl();
        public KeyControl downArrowKey { get; } = new KeyControl();
    }

    public sealed class Gamepad
    {
        public static Gamepad current => null;
        public DpadControl dpad { get; } = new DpadControl();
        public StickControl leftStick { get; } = new StickControl();
        public ButtonControl leftStickButton { get; } = new ButtonControl();
        public ButtonControl buttonSouth { get; } = new ButtonControl();
        public ButtonControl buttonEast { get; } = new ButtonControl();
        public ButtonControl leftShoulder { get; } = new ButtonControl();
        public ButtonControl rightShoulder { get; } = new ButtonControl();
        public ButtonControl startButton { get; } = new ButtonControl();
    }

    public sealed class Mouse
    {
        public static Mouse current => null;
        public ButtonControl leftButton { get; } = new ButtonControl();
        public Vector2Control position { get; } = new Vector2Control();
    }

    public sealed class Touchscreen
    {
        public static Touchscreen current => null;
        public TouchControl primaryTouch { get; } = new TouchControl();
    }
}
