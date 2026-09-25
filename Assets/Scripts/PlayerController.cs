using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif
/// <summary>Third-person locomotion foundation for running, sprinting, variable jumping, sliding, dodging, swimming and diving.</summary>
[RequireComponent(typeof(CharacterController))]
public sealed class PlayerController : MonoBehaviour
{
    public enum MovementState { Grounded, Airborne, Sliding, Swimming, Diving, Mantling, Dead }
    [SerializeField] private CharacterController controller;
    [SerializeField] private Transform cameraTransform;
    [Header("Movement")] [Min(0)] [SerializeField] private float runSpeed=6f, sprintSpeed=9f, acceleration=22f, rotationSharpness=14f, gravity=25f;
    [Header("Jump")] [Min(0)] [SerializeField] private float jumpHeight=2.2f, jumpCutMultiplier=2.2f, coyoteTime=.12f;
    [Header("Slide/Dodge")] [Min(0)] [SerializeField] private float slideSpeed=11f, slideDuration=.75f, dodgeSpeed=13f, dodgeDuration=.22f, dodgeCooldown=.65f;
    [Header("Water")] [Min(0)] [SerializeField] private float swimSpeed=4.5f, diveSpeed=7f;
    [SerializeField] private float swipeThresholdPixels=60f;
    public MovementState State {get;private set;}=MovementState.Grounded;
    public Vector3 Velocity=>velocity;
    public bool IsGrounded=>controller!=null&&controller.isGrounded;
    public bool IsSprinting{get;private set;}
    private Vector3 velocity,planarVelocity,dodgeDirection=Vector3.forward;
    private Vector2 moveInput,touchStart;
    private float lastGroundedTime=-999f,slideEndTime,dodgeEndTime,nextDodgeTime;
    private bool jumpHeld,jumpPressed,slidePressed,dodgePressed;
    private void Reset()=>controller=GetComponent<CharacterController>();
    private void Awake(){if(!controller)controller=GetComponent<CharacterController>();if(!cameraTransform&&Camera.main)cameraTransform=Camera.main.transform;}
    private void Update(){ReadInput();UpdateState();Move(Time.deltaTime);}
    /// <summary>Feeds normalized movement from a virtual joystick or custom UI.</summary>
    public void SetMoveInput(Vector2 value)=>moveInput=Vector2.ClampMagnitude(value,1f);
    /// <summary>Queues a jump request.</summary>
    public void PressJump()=>jumpPressed=true;
    /// <summary>Queues a slide request.</summary>
    public void PressSlide()=>slidePressed=true;
    /// <summary>Queues a directional dodge.</summary>
    public void PressDodge(Vector2 direction){if(direction.sqrMagnitude>.01f)moveInput=Vector2.ClampMagnitude(direction,1f);dodgePressed=true;}
    /// <summary>Enters the swimming state.</summary>
    public void EnterWater(){if(State!=MovementState.Dead)State=MovementState.Swimming;}
    /// <summary>Leaves the swimming state.</summary>
    public void ExitWater(){if(State==MovementState.Swimming||State==MovementState.Diving)State=MovementState.Grounded;}
    /// <summary>Switches between swimming and diving.</summary>
    public void SetDiving(bool diving){if(State!=MovementState.Dead)State=diving?MovementState.Diving:MovementState.Swimming;}
    /// <summary>Stops locomotion and marks the character dead.</summary>
    public void Kill(){State=MovementState.Dead;velocity=planarVelocity=Vector3.zero;}
    private void ReadInput(){
#if ENABLE_INPUT_SYSTEM
        var k=Keyboard.current;var g=Gamepad.current;Vector2 i=Vector2.zero;
        if(k!=null){i=new Vector2((k.dKey.isPressed?1:0)-(k.aKey.isPressed?1:0),(k.wKey.isPressed?1:0)-(k.sKey.isPressed?1:0));jumpPressed|=k.spaceKey.wasPressedThisFrame;jumpHeld|=k.spaceKey.isPressed;slidePressed|=k.cKey.wasPressedThisFrame||k.leftCtrlKey.wasPressedThisFrame;dodgePressed|=k.eKey.wasPressedThisFrame;IsSprinting=k.leftShiftKey.isPressed;}
        if(g!=null){Vector2 stick=g.leftStick.ReadValue();if(stick.sqrMagnitude>i.sqrMagnitude)i=stick;jumpPressed|=g.buttonSouth.wasPressedThisFrame;jumpHeld|=g.buttonSouth.isPressed;slidePressed|=g.buttonEast.wasPressedThisFrame;dodgePressed|=g.leftShoulder.wasPressedThisFrame;IsSprinting|=g.leftStickButton.isPressed;}
        if(i.sqrMagnitude>.001f)moveInput=Vector2.ClampMagnitude(i,1f);
#else
        moveInput=new Vector2(Input.GetAxisRaw("Horizontal"),Input.GetAxisRaw("Vertical"));jumpPressed|=Input.GetButtonDown("Jump");jumpHeld|=Input.GetButton("Jump");slidePressed|=Input.GetKeyDown(KeyCode.C)||Input.GetKeyDown(KeyCode.LeftControl);dodgePressed|=Input.GetKeyDown(KeyCode.E);IsSprinting=Input.GetKey(KeyCode.LeftShift);
#endif
        if(Input.touchCount>0){Touch t=Input.GetTouch(0);if(t.phase==TouchPhase.Began)touchStart=t.position;if(t.phase==TouchPhase.Ended){Vector2 d=t.position-touchStart;if(d.magnitude>=swipeThresholdPixels){if(Mathf.Abs(d.y)>Mathf.Abs(d.x)){if(d.y>0)jumpPressed=true;else slidePressed=true;}else dodgePressed=true;}}}
    }
    private void UpdateState(){
        if(State==MovementState.Dead||State==MovementState.Mantling)return;
        if(IsGrounded)lastGroundedTime=Time.time;
        if(State!=MovementState.Swimming&&State!=MovementState.Diving&&Time.time<slideEndTime){State=MovementState.Sliding;return;}
        if(State!=MovementState.Swimming&&State!=MovementState.Diving&&Time.time<dodgeEndTime)return;
        if(State==MovementState.Swimming||State==MovementState.Diving)return;
        State=IsGrounded?MovementState.Grounded:MovementState.Airborne;
        if(slidePressed&&IsGrounded&&moveInput.y>.1f){State=MovementState.Sliding;slideEndTime=Time.time+slideDuration;}
        if(dodgePressed&&Time.time>=nextDodgeTime){dodgeDirection=GetWorldDirection();if(dodgeDirection.sqrMagnitude<.01f)dodgeDirection=transform.forward;dodgeEndTime=Time.time+dodgeDuration;nextDodgeTime=Time.time+dodgeCooldown;}
    }
    private void Move(float dt){
        if(State==MovementState.Dead)return;
        if(State==MovementState.Swimming||State==MovementState.Diving){Vector3 d=GetWorldDirection();float s=State==MovementState.Diving?diveSpeed:swimSpeed;float y=State==MovementState.Diving?-1f:(jumpHeld?1f:0f);velocity=Vector3.Lerp(velocity,d*s+Vector3.up*y*s*.55f,1f-Mathf.Exp(-acceleration*dt));controller.Move(velocity*dt);Rotate(d,dt);ClearInput();return;}
        if(Time.time<dodgeEndTime){controller.Move(dodgeDirection*dodgeSpeed*dt);Rotate(dodgeDirection,dt);ClearInput();return;}
        Vector3 dir=GetWorldDirection();float speed=State==MovementState.Sliding?slideSpeed:(IsSprinting?sprintSpeed:runSpeed);planarVelocity=Vector3.MoveTowards(planarVelocity,dir*speed,acceleration*dt);if(State==MovementState.Sliding)planarVelocity=transform.forward*slideSpeed;if(dir.sqrMagnitude>.001f)Rotate(dir,dt);
        if(IsGrounded&&velocity.y<0)velocity.y=-2f;
        if(jumpPressed&&Time.time-lastGroundedTime<=coyoteTime)velocity.y=Mathf.Sqrt(jumpHeight*2f*gravity);
        if(!jumpHeld&&velocity.y>0)velocity.y-=gravity*jumpCutMultiplier*dt;velocity.y-=gravity*dt;
        controller.Move((planarVelocity+Vector3.up*velocity.y)*dt);ClearInput();
    }
    private Vector3 GetWorldDirection(){Vector3 f=cameraTransform?Vector3.ProjectOnPlane(cameraTransform.forward,Vector3.up).normalized:Vector3.forward;Vector3 r=cameraTransform?Vector3.ProjectOnPlane(cameraTransform.right,Vector3.up).normalized:Vector3.right;return Vector3.ClampMagnitude(r*moveInput.x+f*moveInput.y,1f);}
    private void Rotate(Vector3 d,float dt){if(d.sqrMagnitude<.001f)return;transform.rotation=Quaternion.Slerp(transform.rotation,Quaternion.LookRotation(d,Vector3.up),1f-Mathf.Exp(-rotationSharpness*dt));}
    private void ClearInput(){jumpPressed=slidePressed=dodgePressed=false;jumpHeld=false;}
}