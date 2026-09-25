using UnityEngine;
/// <summary>Reusable finite-state-machine predator for ground, flying and aquatic species.</summary>
public sealed class PredatorAI:MonoBehaviour
{
 public enum AIState{Patrol,Detect,Chase,PounceCharge,Flee,Stunned,Dead}
 public enum MovementMode{Ground,Flying,Aquatic}
 [SerializeField]private Transform target;[SerializeField]private Transform[] patrolPoints;
 [SerializeField]private MovementMode movementMode=MovementMode.Ground;
 [SerializeField,Min(.1f)]private float patrolSpeed=2.5f,chaseSpeed=6f,detectionRange=25f,attackRange=2f,pounceCooldown=3f;
 [SerializeField,Range(0,1)]private float fleeHealthThreshold=.15f;[SerializeField]private LayerMask lineOfSightMask=~0;
 public AIState State{get;private set;}=AIState.Patrol;public float Health{get;private set;}=100f;
 private int patrolIndex;private float nextPounce,stunUntil;private Vector3 velocity;
 private void Update(){if(State==AIState.Dead)return;if(Time.time<stunUntil){State=AIState.Stunned;return;}if(!target){GameObject p=GameObject.FindGameObjectWithTag("Player");if(p)target=p.transform;}float d=target?Vector3.Distance(transform.position,target.position):float.PositiveInfinity;bool seen=target&&d<=detectionRange&&HasLineOfSight();if(Health<=0){State=AIState.Dead;return;}if(Health/100f<=fleeHealthThreshold)State=AIState.Flee;else if(seen&&d<=attackRange)State=AIState.PounceCharge;else if(seen)State=AIState.Chase;else if(State!=AIState.Flee)State=AIState.Patrol;switch(State){case AIState.Patrol:Patrol();break;case AIState.Chase:MoveToward(target.position,chaseSpeed);break;case AIState.PounceCharge:AttackApproach();break;case AIState.Flee:if(target)MoveToward(transform.position+(transform.position-target.position).normalized*20f,chaseSpeed);break;}}
 /// <summary>Applies damage and optional stun.</summary>
 public void ApplyDamage(float amount,float stunSeconds=0){Health=Mathf.Max(0,Health-Mathf.Max(0,amount));if(stunSeconds>0)stunUntil=Time.time+stunSeconds;if(Health<=0)State=AIState.Dead;}
 /// <summary>Assigns the chase target.</summary>public void SetTarget(Transform newTarget)=>target=newTarget;
 private void Patrol(){if(patrolPoints==null||patrolPoints.Length==0)return;Transform p=patrolPoints[patrolIndex];MoveToward(p.position,patrolSpeed);if(Vector3.Distance(transform.position,p.position)<1.2f)patrolIndex=(patrolIndex+1)%patrolPoints.Length;}
 private void AttackApproach(){if(!target)return;MoveToward(target.position,chaseSpeed);if(Time.time>=nextPounce){nextPounce=Time.time+pounceCooldown;SendMessage("OnPredatorAttackWindow",SendMessageOptions.DontRequireReceiver);}}
 private void MoveToward(Vector3 destination,float speed){Vector3 d=destination-transform.position;if(movementMode!=MovementMode.Aquatic)d.y=0;if(d.sqrMagnitude<.01f)return;d.Normalize();velocity=Vector3.MoveTowards(velocity,d*speed,speed*8*Time.deltaTime);transform.position+=velocity*Time.deltaTime;transform.rotation=Quaternion.Slerp(transform.rotation,Quaternion.LookRotation(d),1-Mathf.Exp(-10*Time.deltaTime));}
 private bool HasLineOfSight(){if(!target)return false;Vector3 o=transform.position+Vector3.up,d=target.position+Vector3.up-o;return !Physics.Raycast(o,d.normalized,d.magnitude,lineOfSightMask,QueryTriggerInteraction.Ignore);}
}