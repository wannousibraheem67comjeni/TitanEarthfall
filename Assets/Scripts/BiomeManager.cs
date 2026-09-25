using System;
using UnityEngine;
/// <summary>Orders biome progression and enforces the exact 360-second survival window for Mountain Heights.</summary>
public sealed class BiomeManager:MonoBehaviour
{
 public enum Biome{MountainHeights,AlpineSnowGlaciers,UrbanCity,CoastalDunes,CrowdedBeach,AbyssalTrench,HighSeasTempest,RapidRivers,CalmLake,SaltFlats,FarmlandVillage,DeepWoodland,ScenicWilderness,HarshDesert,CyberMetropolis,HomelandVillage}
 [Serializable] public sealed class BiomeDefinition{public Biome biome;[Min(.1f)]public float segmentLength=250f;public bool safeZone;}
 [SerializeField]private BiomeDefinition[] definitions;
 [SerializeField]private int startingBiomeIndex;
 [SerializeField,Min(.1f)]private float stageOneDurationSeconds=360f;
 [SerializeField]private bool autoAdvanceStageOne=true;
 public Biome CurrentBiome{get;private set;} public int CurrentBiomeIndex{get;private set;}
 public float StageElapsedSeconds{get;private set;} public float StageOneRemainingSeconds=>Mathf.Max(0,stageOneDurationSeconds-StageElapsedSeconds);
 public bool StageOneComplete=>StageElapsedSeconds>=stageOneDurationSeconds;
 public event Action<Biome,Biome> BiomeChanged;public event Action StageOneCompleted;
 private bool completionRaised;
 private void Awake(){if(definitions==null||definitions.Length==0)definitions=new[]{new BiomeDefinition{biome=Biome.MountainHeights}};CurrentBiomeIndex=Mathf.Clamp(startingBiomeIndex,0,definitions.Length-1);CurrentBiome=definitions[CurrentBiomeIndex].biome;}
 private void Update(){if(CurrentBiomeIndex==0&&!StageOneComplete){StageElapsedSeconds+=Time.deltaTime;if(StageOneComplete&&!completionRaised){completionRaised=true;StageOneCompleted?.Invoke();if(autoAdvanceStageOne)AdvanceBiome();}}}
 /// <summary>Moves to the next configured biome.</summary>
 public bool AdvanceBiome(){if(CurrentBiomeIndex>=definitions.Length-1)return false;Biome old=CurrentBiome;CurrentBiome=definitions[++CurrentBiomeIndex].biome;BiomeChanged?.Invoke(old,CurrentBiome);return true;}
 /// <summary>Moves directly to a configured biome index.</summary>
 public bool SetBiome(int index){if(index<0||index>=definitions.Length)return false;if(index==CurrentBiomeIndex)return true;Biome old=CurrentBiome;CurrentBiomeIndex=index;CurrentBiome=definitions[index].biome;BiomeChanged?.Invoke(old,CurrentBiome);return true;}
 /// <summary>Resets the six-minute Stage 1 timer.</summary>
 public void ResetStageOneTimer(){StageElapsedSeconds=0;completionRaised=false;}
}