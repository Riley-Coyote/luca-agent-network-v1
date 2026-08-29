use luca_continuity::{
    build_body_free_run_record, build_generation_packet, build_reader_packet, validate_assay_v1,
    AssayConditionV1, AssayFaultModeV1, AssayGoldenLifeV1, AssayManifestV1, AssayPrivateRunV1,
    AssayRunMetadataV1,
};
use serde::{de::DeserializeOwned, Serialize};
use std::{
    collections::BTreeSet,
    env,
    error::Error,
    fs::{self, DirBuilder, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::os::unix::fs::DirBuilderExt;

const MAX_ASSAY_JSON_BYTES: u64 = 8 * 1024 * 1024;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

#[derive(Serialize)]
struct PrivatePanelIndexEntry {
    run_id: String,
    scenario_id: String,
    condition: AssayConditionV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    fault_mode: Option<AssayFaultModeV1>,
    generation_packet: String,
}

#[derive(Serialize)]
struct PrivatePanelIndex {
    schema: String,
    assay_version: String,
    entries: Vec<PrivatePanelIndexEntry>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("continuity assay: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    match arguments.as_slice() {
        [command, manifest, fixture] if command == "validate" => {
            let manifest = read_json::<AssayManifestV1>(manifest)?;
            let fixture = read_json::<AssayGoldenLifeV1>(fixture)?;
            validate_assay_v1(&manifest, &fixture)?;
            println!(
                "valid {}: {} scenarios, {} golden events",
                manifest.assay_version,
                manifest.scenarios.len(),
                fixture.events.len()
            );
            Ok(())
        }
        [command, manifest, fixture, output_directory] if command == "prepare-panel" => {
            prepare_panel(manifest, fixture, output_directory)
        }
        [command, manifest, fixture, scenario, condition, run_id, output]
            if command == "prepare" =>
        {
            prepare(manifest, fixture, scenario, condition, run_id, None, output)
        }
        [command, manifest, fixture, scenario, condition, run_id, fault, output]
            if command == "prepare" =>
        {
            prepare(
                manifest,
                fixture,
                scenario,
                condition,
                run_id,
                Some(fault),
                output,
            )
        }
        [command, manifest, private_run, output] if command == "reader-packet" => {
            let manifest = read_json::<AssayManifestV1>(manifest)?;
            let private_run = read_json::<AssayPrivateRunV1>(private_run)?;
            let packet = build_reader_packet(&manifest, &private_run)?;
            write_private_json(output, &packet)
        }
        [command, private_run, metadata, output] if command == "body-free-record" => {
            let private_run = read_json::<AssayPrivateRunV1>(private_run)?;
            let metadata = read_json::<AssayRunMetadataV1>(metadata)?;
            let record = build_body_free_run_record(&private_run, metadata)?;
            write_private_json(output, &record)
        }
        _ => Err(usage().into()),
    }
}

fn prepare_panel(
    manifest_path: &str,
    fixture_path: &str,
    output_directory: &str,
) -> Result<(), Box<dyn Error>> {
    let manifest = read_json::<AssayManifestV1>(manifest_path)?;
    let fixture = read_json::<AssayGoldenLifeV1>(fixture_path)?;
    validate_assay_v1(&manifest, &fixture)?;
    let directory = Path::new(output_directory);
    let mut builder = DirBuilder::new();
    #[cfg(unix)]
    builder.mode(0o700);
    builder
        .create(directory)
        .map_err(|error| format!("create private panel {}: {error}", directory.display()))?;

    let mut entries = Vec::new();
    let mut run_ids = BTreeSet::new();
    for scenario in manifest
        .scenarios
        .iter()
        .filter(|scenario| scenario.scenario_id.starts_with('C'))
    {
        for condition in &scenario.conditions {
            let fault_modes = if *condition == AssayConditionV1::Faulted {
                scenario
                    .fault_modes
                    .iter()
                    .copied()
                    .map(Some)
                    .collect::<Vec<_>>()
            } else {
                vec![None]
            };
            for fault_mode in fault_modes {
                let run_id = loop {
                    let candidate = opaque_run_id();
                    if run_ids.insert(candidate.clone()) {
                        break candidate;
                    }
                };
                let filename = format!("{run_id}.generation.json");
                let packet = build_generation_packet(
                    &manifest,
                    &fixture,
                    &scenario.scenario_id,
                    *condition,
                    &run_id,
                    fault_mode,
                )?;
                write_private_json(directory.join(&filename), &packet)?;
                entries.push(PrivatePanelIndexEntry {
                    run_id,
                    scenario_id: scenario.scenario_id.clone(),
                    condition: *condition,
                    fault_mode,
                    generation_packet: filename,
                });
            }
        }
    }
    entries.sort_by(|left, right| left.run_id.cmp(&right.run_id));
    write_private_json(
        directory.join("panel-index.private.json"),
        &PrivatePanelIndex {
            schema: "polyphonic.continuity-assay.private-panel-index.v1".to_owned(),
            assay_version: manifest.assay_version,
            entries,
        },
    )?;
    Ok(())
}

fn prepare(
    manifest_path: &str,
    fixture_path: &str,
    scenario_id: &str,
    condition: &str,
    run_id: &str,
    fault: Option<&String>,
    output: &str,
) -> Result<(), Box<dyn Error>> {
    let manifest = read_json::<AssayManifestV1>(manifest_path)?;
    let fixture = read_json::<AssayGoldenLifeV1>(fixture_path)?;
    let condition = parse_condition(condition)?;
    let fault = fault.map(|value| parse_fault(value)).transpose()?;
    let packet =
        build_generation_packet(&manifest, &fixture, scenario_id, condition, run_id, fault)?;
    write_private_json(output, &packet)
}

fn read_json<T: DeserializeOwned>(path: impl AsRef<Path>) -> Result<T, Box<dyn Error>> {
    let path = path.as_ref();
    let metadata =
        fs::metadata(path).map_err(|error| format!("inspect {}: {error}", path.display()))?;
    if !metadata.is_file() || metadata.len() > MAX_ASSAY_JSON_BYTES {
        return Err(format!(
            "assay input must be a regular JSON file no larger than {MAX_ASSAY_JSON_BYTES} bytes: {}",
            path.display()
        )
        .into());
    }
    let bytes = fs::read(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("parse {}: {error}", path.display()).into())
}

fn write_private_json(
    path: impl AsRef<Path>,
    value: &impl Serialize,
) -> Result<(), Box<dyn Error>> {
    let path = path.as_ref();
    let parent = path
        .parent()
        .filter(|candidate| !candidate.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(format!("output parent does not exist: {}", parent.display()).into());
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .map_err(|error| format!("create private output {}: {error}", path.display()))?;
    let mut encoded = serde_json::to_vec_pretty(value)?;
    encoded.push(b'\n');
    file.write_all(&encoded)?;
    file.sync_all()?;
    println!("wrote {}", path.display());
    Ok(())
}

fn parse_condition(value: &str) -> Result<AssayConditionV1, Box<dyn Error>> {
    match value {
        "N" => Ok(AssayConditionV1::NoContinuity),
        "D" => Ok(AssayConditionV1::Dossier),
        "W" => Ok(AssayConditionV1::Wake),
        "F" => Ok(AssayConditionV1::Faulted),
        _ => Err(format!("unknown condition {value}; expected N, D, W, or F").into()),
    }
}

fn parse_fault(value: &str) -> Result<AssayFaultModeV1, Box<dyn Error>> {
    match value {
        "locked" => Ok(AssayFaultModeV1::Locked),
        "missing" => Ok(AssayFaultModeV1::Missing),
        "corrupt" => Ok(AssayFaultModeV1::Corrupt),
        "stale" => Ok(AssayFaultModeV1::Stale),
        "denied" => Ok(AssayFaultModeV1::Denied),
        "timeout" => Ok(AssayFaultModeV1::Timeout),
        "partial" => Ok(AssayFaultModeV1::Partial),
        _ => Err(format!(
            "unknown fault {value}; expected locked, missing, corrupt, stale, denied, timeout, or partial"
        )
        .into()),
    }
}

fn opaque_run_id() -> String {
    let bytes: [u8; 16] = rand::random();
    format!("run-{}", hex::encode(bytes))
}

fn usage() -> String {
    let binary = env::args()
        .next()
        .map(PathBuf::from)
        .and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "luca-continuity-assay".to_owned());
    format!(
        "usage:\n  {binary} validate <manifest.json> <golden-life.json>\n  \
         {binary} prepare-panel <manifest.json> <golden-life.json> <new-private-directory>\n  \
         {binary} prepare <manifest.json> <golden-life.json> <scenario> <N|D|W> <run-id> <output.json>\n  \
         {binary} prepare <manifest.json> <golden-life.json> <scenario> F <run-id> <fault> <output.json>\n  \
         {binary} reader-packet <manifest.json> <private-run.json> <output.json>\n  \
         {binary} body-free-record <private-run.json> <metadata.json> <output.json>"
    )
}
