using UnityEngine;
/// <summary>Configurable trigger hazard for damage, fall zones, currents, traction loss, pressure and environmental impacts.</summary>
[RequireComponent(typeof(Collider))]
public sealed class ObstacleHazard:MonoBehaviour
{
 public enum HazardType{Damage,FallZone,Current,Quicksand,Avalanche,Rockfall,Ice,Toxic,Pressure}
 [SerializeField]private HazardType hazardType;[SerializeField,Min(0)]private float damagePerSecond=20f;[SerializeField]private Vector3 force;[SerializeField,Range(0,1)]private float tractionMultiplier=1;[SerializeField,Min(0)]private float oxygenDrainPerSecond;[SerializeField]private bool continuous=true;
 public HazardType Type=>hazardType;public float TractionMultiplier=>tractionMultiplier;
 private void Reset(){GetComponent<Collider>().isTrigger=true;}
 private void OnTriggerEnter(Collider other){Apply(other,Time.fixedDeltaTime);}
 private void OnTriggerStay(Collider other){if(continuous)Apply(other,Time.fixedDeltaTime);}
 private void Apply(Collider other,float dt){if(!other.CompareTag("Player"))return;if(hazardType==HazardType.FallZone){other.SendMessage("Kill",SendMessageOptions.DontRequireReceiver);return;}if(damagePerSecond>0)other.SendMessage("ApplyDamage",damagePerSecond*dt,SendMessageOptions.DontRequireReceiver);if(oxygenDrainPerSecond>0)other.SendMessage("DrainOxygen",oxygenDrainPerSecond*dt,SendMessageOptions.DontRequireReceiver);if(force.sqrMagnitude>.001f){Rigidbody rb=other.attachedRigidbody;if(rb)rb.AddForce(force,ForceMode.Acceleration);else other.transform.position+=force*dt;}if(hazardType==HazardType.Avalanche||hazardType==HazardType.Rockfall)other.SendMessage("OnHazardImpact",SendMessageOptions.DontRequireReceiver);}
}